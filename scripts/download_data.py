"""Query and cache a small, provenance-preserving SIA image sample.

The script downloads the archive products returned by the IRSA SIA v2 service
instead of synthesizing training data.

Example:
    python scripts/download_data.py --ra 83.8 --dec -5.4 --size 0.1 \
        --service-url "https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_qr2" \
        --max-records 5 --output data/raw
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io.votable import parse


USER_AGENT = "cosmic-predict-data-loader/0.1"

# Transient HTTP statuses worth retrying with exponential backoff so the
# scraper does not hammer IRSA or trip its rate limiter.
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
_RETRY_BASE_DELAY = 5.0
_RETRY_MAX_DELAY = 60.0


def _retry_delay(error: urllib.error.HTTPError, attempt: int) -> float:
    retry_after = error.headers.get("Retry-After") if error.headers else None
    if retry_after:
        try:
            return min(float(retry_after), _RETRY_MAX_DELAY)
        except ValueError:
            pass
    return min(_RETRY_BASE_DELAY * (2 ** attempt), _RETRY_MAX_DELAY)


def _open_with_retry(request: urllib.request.Request, *, timeout: float, retries: int = 3):
    """Open a request, retrying transient failures with polite backoff."""
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            return urllib.request.urlopen(
                request, timeout=timeout, context=ssl.create_default_context()
            )
        except urllib.error.HTTPError as error:
            if error.code in _RETRYABLE_STATUS and attempt < retries - 1:
                wait = _retry_delay(error, attempt)
                print(f"transient HTTP {error.code}; retrying in {wait:.1f}s", file=sys.stderr)
                time.sleep(wait)
                last_error = error
                continue
            raise
        except urllib.error.URLError as error:
            if attempt < retries - 1:
                wait = min(_RETRY_BASE_DELAY * (2 ** attempt), _RETRY_MAX_DELAY)
                print(f"connection error {error}; retrying in {wait:.1f}s", file=sys.stderr)
                time.sleep(wait)
                last_error = error
                continue
            raise
    raise last_error  # type: ignore[misc]


def build_query_url(
    service_url: str,
    *,
    ra: float,
    dec: float,
    size: float,
    band: str | None,
    start_time: str | None,
    end_time: str | None,
    max_records: int,
) -> str:
    """Build a bounded SIA v2 query URL."""

    if not -90.0 <= dec <= 90.0:
        raise ValueError("dec must be between -90 and 90 degrees")
    if not 0.0 <= ra < 360.0:
        raise ValueError("ra must be in the range [0, 360)")
    if not 0.0 < size <= 10.0:
        raise ValueError("size must be greater than 0 and no larger than 10 degrees")
    if max_records < 1:
        raise ValueError("max_records must be positive")

    # SIA v2 only defines POS/BAND/TIME/... ; SIZE (an SIA v1 parameter) and
    # RESPONSEFORMAT (a TAP parameter) make IRSA return an error VOTable with
    # no data table, which caused "No table found in VOTABLE file".
    params: dict[str, str] = {
        "POS": f"CIRCLE {ra} {dec} {size / 2}",
        "MAXREC": str(max_records),
    }
    if band:
        params["BAND"] = band
    if start_time:
        params["TIME"] = f"{start_time}/{end_time or start_time}"
    elif end_time:
        raise ValueError("--end-time requires --start-time")
    separator = "&" if "?" in service_url else "?"
    return f"{service_url}{separator}{urllib.parse.urlencode(params)}"


def _service_messages(votable: Any) -> list[str]:
    """Collect INFO messages (e.g. QUERY_STATUS=ERROR) from a VOTable."""

    messages: list[str] = []
    for info in getattr(votable, "infos", []):
        messages.append(f"{info.name}={info.value} {info.content or ''}".strip())
    for resource in votable.resources:
        for info in getattr(resource, "infos", []):
            messages.append(f"{info.name}={info.value} {info.content or ''}".strip())
    return messages


def fetch_votable(url: str, *, timeout: float) -> list[dict[str, Any]]:
    """Fetch and parse an SIA VOTable response into a list of row dicts."""

    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/x-votable+xml",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with _open_with_retry(request, timeout=timeout) as response:
            content = response.read()
    except urllib.error.HTTPError as error:
        body = error.read()[:500].decode("utf-8", errors="replace")
        raise ValueError(f"HTTP {error.code} from service: {body}") from error

    try:
        votable = parse(BytesIO(content), verify="ignore")
    except Exception as error:
        snippet = content[:500].decode("utf-8", errors="replace")
        raise ValueError(f"response was not a valid VOTable: {error}\n{snippet}") from error

    tables = [t for t in votable.iter_tables()]
    messages = _service_messages(votable)
    if messages:
        print("Service messages:", *messages, sep="\n  ")

    if not tables:
        raise ValueError(
            "service returned no data table. Service messages: "
            + (" | ".join(messages) or "none")
            + f"\nQuery URL: {url}"
        )

    table = tables[0].to_table(use_names_over_ids=True)

    records: list[dict[str, Any]] = []
    for row in table:
        record: dict[str, Any] = {}
        for column in table.colnames:
            value = row[column]
            if np.ma.is_masked(value):
                record[column] = None
            elif isinstance(value, bytes):
                record[column] = value.decode("utf-8", errors="replace").strip()
            else:
                record[column] = str(value).strip()
        records.append(record)
    return records


def _find_data_url(record: dict[str, Any]) -> str | None:
    """Find a downloadable link while retaining the complete record."""

    normalized = {str(k).strip().lower(): v for k, v in record.items()}
    access_url = normalized.get("access_url")
    if isinstance(access_url, str) and access_url.startswith(("https://", "http://")):
        return access_url
    return None


def _safe_filename(url: str, index: int) -> str:
    suffix = Path(urllib.parse.urlparse(url).path).suffix.lower()
    if suffix not in {".fits", ".fit", ".fz", ".gz"}:
        suffix = ".fits"
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]
    return f"observation_{index:03d}_{digest}{suffix}"


def download_file(url: str, destination: Path, *, timeout: float) -> None:
    """Download one archive product atomically into the selected cache."""

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    temporary = destination.with_suffix(destination.suffix + ".part")
    with _open_with_retry(request, timeout=timeout) as response:
        with temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    temporary.replace(destination)


def download_sample(
    *,
    service_url: str,
    output_dir: Path,
    ra: float,
    dec: float,
    size: float,
    band: str | None,
    start_time: str | None,
    end_time: str | None,
    max_records: int,
    timeout: float,
    delay: float = 0.0,
) -> Path:
    """Query SIA, download products, and write a reproducible manifest.

    ``delay`` adds a fixed sleep between downloads so batch runs stay polite
    to the archive and avoid rate limiting / IP bans.
    """

    output_dir.mkdir(parents=True, exist_ok=True)
    query_url = build_query_url(
        service_url,
        ra=ra,
        dec=dec,
        size=size,
        band=band,
        start_time=start_time,
        end_time=end_time,
        max_records=max_records,
    )
    print(f"Query URL: {query_url}")
    records = fetch_votable(query_url, timeout=timeout)

    print(f"Image records returned: {len(records)}")
    if records:
        print("Columns:", list(records[0].keys()))
        print("First record:")
        for key, value in records[0].items():
            print(f"  {key!r}: {value!r}")

    manifest: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        data_url = _find_data_url(record)
        if data_url is None:
            print(f"Record {index}: no download URL found")
            continue

        filename = _safe_filename(data_url, index)
        destination = output_dir / filename

        print(f"Downloading: {data_url}")
        if not destination.exists():
            download_file(data_url, destination, timeout=timeout)
        print(f"Saved: {destination}")

        manifest.append(
            {
                "local_path": filename,
                "source_url": data_url,
                "query_url": query_url,
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "record": record,
            }
        )
        if delay > 0:
            time.sleep(delay)

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "provider": "IRSA SIA v2",
                "query": {
                    "ra": ra,
                    "dec": dec,
                    "size_deg": size,
                    "band": band,
                    "start_time": start_time,
                    "end_time": end_time,
                },
                "records": manifest,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return manifest_path


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-url", default=os.environ.get("SPHEREX_SIA_URL"))
    parser.add_argument("--ra", type=float, required=True)
    parser.add_argument("--dec", type=float, required=True)
    parser.add_argument("--size", type=float, default=0.5, help="region size in degrees (used as circle diameter)")
    parser.add_argument("--band", help="archive-specific wavelength or band constraint (metres, e.g. 1.0e-6/2.0e-6)")
    parser.add_argument("--start-time")
    parser.add_argument("--end-time")
    parser.add_argument("--max-records", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--delay", type=float, default=0.0, help="seconds to sleep between downloads (rate-limit guard)")
    parser.add_argument("--output", type=Path, default=Path("data/raw"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not args.service_url:
        print(
            "Set SPHEREX_SIA_URL or pass --service-url after verifying the IRSA endpoint.",
            file=sys.stderr,
        )
        return 2
    try:
        manifest_path = download_sample(
            service_url=args.service_url,
            output_dir=args.output,
            ra=args.ra,
            dec=args.dec,
            size=args.size,
            band=args.band,
            start_time=args.start_time,
            end_time=args.end_time,
            max_records=args.max_records,
            timeout=args.timeout,
            delay=args.delay,
        )
    except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError) as error:
        print(f"data download failed: {error}", file=sys.stderr)
        return 1
    print(f"wrote provenance manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
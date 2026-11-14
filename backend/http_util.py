"""Shared outbound-HTTP helper with retry/backoff for archive services.

Both the IRSA live archive and the ESA Gaia TAP service intermittently answer
503 while busy; a short retry with backoff turns those into successful
requests instead of user-facing failures.
"""

from __future__ import annotations

import time
import urllib.error
import urllib.request

USER_AGENT = "cosmic-predict-live/0.1"

_RETRYABLE_HTTP_CODES = {429, 500, 502, 503, 504}


def http_get(url: str, timeout: float, attempts: int = 3) -> bytes:
    """GET with retry/backoff on transient failures (503s, timeouts, resets)."""
    last_error: Exception = RuntimeError(f"download failed: {url}")
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in _RETRYABLE_HTTP_CODES:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
        if attempt < attempts - 1:
            time.sleep(2.0 * (attempt + 1))
    raise last_error

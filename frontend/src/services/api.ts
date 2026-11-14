export type Observation = {
  observation_id: string;
  epoch: string | null;
  band: string | null;
  wavelength: number | null;
  ra: number | null;
  dec: number | null;
  source: "cached" | "live" | string;
  provenance: Record<string, unknown>;
  image_url: string | null;
  asset_status: string;
};

export type GaiaMatch = {
  source_id: string;
  separation_arcsec: number;
  g_mag: number | null;
  pm_total_mas_yr: number | null;
  parallax_mas: number | null;
  variable_flag: string | null;
};

export type Candidate = {
  candidate_id: string;
  source: string;
  classification: string;
  row: number;
  column: number;
  height: number;
  width: number;
  area: number;
  score: number;
  coordinate_space: string;
  ra: number | null;
  dec: number | null;
  gaia_match: GaiaMatch | null;
  gaia_checked: boolean;
  interpretation: string | null;
  caveat: string;
};

export type GaiaOverlaySource = {
  source_id: string;
  ra: number;
  dec: number;
  g_mag: number | null;
  pm_total_mas_yr: number | null;
  variable_flag: string | null;
  x_frac: number;
  y_frac: number;
};

export type GaiaOverlay = {
  status: string;
  ra: number;
  dec: number;
  fov_arcmin: number;
  sources: GaiaOverlaySource[];
  caveats: string[];
  message: string | null;
};

export type Analysis = {
  status: string;
  context_epoch: string;
  target_epoch: string;
  difference_score: number | null;
  difference_image_url: string | null;
  candidates: Candidate[];
  caveats: string[];
  message: string | null;
};

type EpochResponse = {
  status: string;
  observations: Observation[];
  message: string | null;
};

export type TimelineFrame = {
  observation_id: string;
  epoch: string | null;
  band: string | null;
  wavelength: number | null;
  cutout_url: string;
  source: string;
  coverage: number | null;
};

export type SpectrumPoint = {
  observation_id: string;
  epoch: string | null;
  band: string | null;
  wavelength: number;
  surface_brightness: number;
  unit: string;
};

export type Spectrum = {
  status: string;
  ra: number;
  dec: number;
  points: SpectrumPoint[];
  caveats: string[];
  message: string | null;
};

export type Timeline = {
  status: string;
  ra: number;
  dec: number;
  fov_arcmin: number;
  band: string | null;
  available_bands: Record<string, number>;
  frames: TimelineFrame[];
  caveats: string[];
  message: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export function resolveAssetUrl(assetUrl: string | null): string | null {
  if (!assetUrl) return null;
  return assetUrl.startsWith("http") ? assetUrl : `${API_BASE}${assetUrl.replace(/^\/api/, "")}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    // FastAPI returns {"detail": "..."} — surface that human-readable reason.
    let detail = body;
    try {
      detail = (JSON.parse(body) as { detail?: string }).detail ?? body;
    } catch {
      /* not JSON: keep raw body */
    }
    throw new Error(detail || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getEpochs(ra: number, dec: number): Promise<EpochResponse> {
  return request<EpochResponse>(`/epochs?ra=${ra}&dec=${dec}`);
}

export async function getTimeline(ra: number, dec: number, fov = 15, band?: string | null): Promise<Timeline> {
  const bandParam = band ? `&band=${encodeURIComponent(band)}` : "";
  return request<Timeline>(`/timeline?ra=${ra}&dec=${dec}&fov=${fov}${bandParam}`);
}

export async function getImages(): Promise<Observation[]> {
  return request<Observation[]>("/images");
}

export async function analyzePair(
  contextEpoch: string,
  targetEpoch: string,
): Promise<Analysis> {
  return request<Analysis>("/analyze", {
    method: "POST",
    body: JSON.stringify({
      context_epoch: contextEpoch,
      target_epoch: targetEpoch,
      row: 0,
      column: 0,
      size: 128,
    }),
  });
}

export type Health = { status: string; provider: string; observation_count: number };

export async function getSpectrum(ra: number, dec: number): Promise<Spectrum> {
  return request<Spectrum>(`/spectrum?ra=${ra}&dec=${dec}`);
}

export type FetchRegionResult = {
  status: "fetching" | "already_fetched" | "failed" | string;
  region: string;
  frames?: number;
  message?: string | null;
};

/**
 * Ask the backend to pull small cutouts of this position from the live NASA
 * archive. The download runs in the background: repeat the same call to poll
 * until status is "already_fetched" (done) or "failed".
 */
export async function fetchRegion(ra: number, dec: number): Promise<FetchRegionResult> {
  return request<FetchRegionResult>(`/fetch_region?ra=${ra}&dec=${dec}`, { method: "POST" });
}

export async function getHealth(): Promise<Health> {
  return request<Health>("/health");
}

export type FeedItem = {
  ra: number;
  dec: number;
  fov_arcmin: number;
  band: string | null;
  n_frames: number;
  region_key: string;
};

export type Feed = {
  status: string;
  items: FeedItem[];
  caveats: string[];
  message: string | null;
};

export type Mark = {
  id: string;
  created_at: string;
  ra: number;
  dec: number;
  spot_ra: number | null;
  spot_dec: number | null;
  fov_arcmin: number;
  band: string | null;
  observation_id: string | null;
  epoch: string | null;
  note: string | null;
  source: string;
  preview_url: string | null;
  caveat: string;
};

export type MarkCreate = {
  ra: number;
  dec: number;
  fov_arcmin: number;
  band?: string | null;
  observation_id?: string | null;
  epoch?: string | null;
  note?: string | null;
  source?: string;
  x_frac?: number | null;
  y_frac?: number | null;
};

/** Scrollable tiles (real multi-epoch sky positions) for the reel view. */
export async function getFeed(): Promise<Feed> {
  return request<Feed>("/feed");
}

export async function getMarks(): Promise<{ status: string; marks: Mark[] }> {
  return request<{ status: string; marks: Mark[] }>("/marks");
}

/** Save a "this looks suspicious" flag; a tapped spot is converted to sky coordinates server-side. */
export async function createMark(payload: MarkCreate): Promise<Mark> {
  return request<Mark>("/marks", { method: "POST", body: JSON.stringify(payload) });
}

export async function deleteMark(id: string): Promise<void> {
  await request<{ status: string }>(`/marks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Known Gaia DR3 catalog stars inside the current cutout frame (ESA archive, cached). */
export async function getGaiaOverlay(ra: number, dec: number, fov = 15): Promise<GaiaOverlay> {
  return request<GaiaOverlay>(`/gaia?ra=${ra}&dec=${dec}&fov=${fov}`);
}

/** Change detection on the WCS-aligned cutout grid at (ra, dec) — matches the player frames. */
export async function analyzeRegion(
  contextEpoch: string,
  targetEpoch: string,
  ra: number,
  dec: number,
  fov = 15,
  size = 256,
): Promise<Analysis> {
  return request<Analysis>("/analyze_region", {
    method: "POST",
    body: JSON.stringify({
      context_epoch: contextEpoch,
      target_epoch: targetEpoch,
      ra,
      dec,
      fov_arcmin: fov,
      size,
    }),
  });
}

export type PatchCenter = { ra: number; dec: number; fov_arcmin: number };

/** Map a fractional image rectangle (0..1) to the sky center + FOV of that patch. */
export async function patchCenter(
  ra: number,
  dec: number,
  fov: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size = 256,
): Promise<PatchCenter> {
  const params = new URLSearchParams({
    ra: String(ra),
    dec: String(dec),
    fov: String(fov),
    size: String(size),
    x0: String(x0),
    y0: String(y0),
    x1: String(x1),
    y1: String(y1),
  });
  return request<PatchCenter>(`/patch_center?${params.toString()}`);
}

/** OpenCV change detection on the rendered difference image (visual aid, not the significance baseline). */
export async function exploreRegion(
  contextEpoch: string,
  targetEpoch: string,
  ra: number,
  dec: number,
  fov = 15,
  size = 256,
): Promise<Analysis> {
  return request<Analysis>("/explore_region", {
    method: "POST",
    body: JSON.stringify({
      context_epoch: contextEpoch,
      target_epoch: targetEpoch,
      ra,
      dec,
      fov_arcmin: fov,
      size,
    }),
  });
}

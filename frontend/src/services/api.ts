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
  caveat: string;
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

export type FetchRegionResult = { status: string; region: string; frames: number };

/** Ask the backend to pull small cutouts of this position from the live NASA archive. */
export async function fetchRegion(ra: number, dec: number): Promise<FetchRegionResult> {
  return request<FetchRegionResult>(`/fetch_region?ra=${ra}&dec=${dec}`, { method: "POST" });
}

export async function getHealth(): Promise<Health> {
  return request<Health>("/health");
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

export type Observation = {
  observation_id: string;
  epoch: string | null;
  band: string | null;
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
    throw new Error(body || `API request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getEpochs(ra: number, dec: number): Promise<EpochResponse> {
  return request<EpochResponse>(`/epochs?ra=${ra}&dec=${dec}`);
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

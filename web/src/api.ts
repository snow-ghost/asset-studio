// Client for the studiod HTTP API. The base URL is the studiod origin: in development the frontend runs on
// its own port and talks across origins (VITE_STUDIO_API), in production both are one origin (empty base).

export type Kind = 'character' | 'creature' | 'item' | 'landscape' | 'texture';

export interface Asset {
  id: string;
  name: string;
  kind: Kind;
  format: string;
  tags?: string[];
  wowdRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRequest {
  id?: string;
  name: string;
  kind: Kind;
  format: string;
  tags?: string[];
  wowdRef?: string;
  /** base64 payload; omit for a metadata-only update. */
  data?: string;
}

const BASE = (import.meta.env.VITE_STUDIO_API ?? 'http://localhost:8099').replace(/\/$/, '');

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  base: BASE,

  list(): Promise<Asset[]> {
    return fetch(`${BASE}/api/assets`).then((r) => json<Asset[]>(r));
  },

  save(req: SaveRequest): Promise<Asset> {
    return fetch(`${BASE}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then((r) => json<Asset>(r));
  },

  remove(id: string): Promise<void> {
    return fetch(`${BASE}/api/assets/${id}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok && r.status !== 204) throw new Error(`${r.status} ${r.statusText}`);
    });
  },

  /** URL of an asset's raw payload — a glb/gltf model or a png texture. */
  payloadUrl(id: string): string {
    return `${BASE}/api/assets/${id}/payload`;
  },
};

/** base64 encodes an ArrayBuffer without blowing the call stack on large models. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

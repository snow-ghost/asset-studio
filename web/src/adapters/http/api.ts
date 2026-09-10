// The studiod HTTP API as an AssetGateway. Everything about the wire lives here: URLs, JSON shapes, the
// base64 encoding of payloads, the error body. The app layer sees only the port.

import type { Asset, SaveRequest } from '../../domain/asset';
import type { AssetGateway } from '../../app/ports';

/**
 * resolveApiBase decides where studiod is. An explicit VITE_STUDIO_API always wins. Otherwise the answer
 * depends on how the app is served: under the Vite dev server the API is another origin on studiod's dev
 * port; in a production build studiod serves the app itself (`studiod -web`), so the API is the same
 * origin and the base must be empty. A hardcoded localhost:8099 default would break single-origin mode
 * on any other port or host.
 */
export function resolveApiBase(env: { VITE_STUDIO_API?: string; DEV?: boolean }): string {
  const base = env.VITE_STUDIO_API ?? (env.DEV ? 'http://localhost:8099' : '');
  return base.replace(/\/$/, '');
}

interface SaveBody extends SaveRequest {
  /** base64 payload; absent for a metadata-only update. */
  data?: string;
}

export class HttpAssetGateway implements AssetGateway {
  constructor(readonly base: string) {}

  async list(): Promise<Asset[]> {
    return json<Asset[]>(await fetch(`${this.base}/api/assets`));
  }

  async save(req: SaveRequest, payload: ArrayBuffer | null): Promise<Asset> {
    const body: SaveBody = payload ? { ...req, data: toBase64(payload) } : { ...req };
    const res = await fetch(`${this.base}/api/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return json<Asset>(res);
  }

  async remove(id: string): Promise<void> {
    const res = await fetch(`${this.base}/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`${res.status} ${res.statusText}`);
  }

  payloadUrl(id: string): string {
    return `${this.base}/api/assets/${encodeURIComponent(id)}/payload`;
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** toBase64 encodes an ArrayBuffer in chunks, so a large model does not blow the call stack. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

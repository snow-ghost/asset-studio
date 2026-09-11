// The vocabulary of an asset, shared with studiod (server/internal/domain) and, through the manifest, with
// wowd's client. Pure data and rules: this file knows nothing about three.js, the DOM or HTTP, so the same
// rules run in Node under Vitest and stay reusable wherever the studio grows (AGENTS.md, invariant 3).

import type { TextureParams } from './texture';

/** The kinds the studio understands, in the order the UI offers them. */
export const KINDS = ['character', 'creature', 'item', 'landscape', 'texture'] as const;
export type Kind = (typeof KINDS)[number];

/** Payload formats studiod stores and wowd's client loads natively: glTF for models, PNG for textures. */
export type Format = 'glb' | 'gltf' | 'png';

export interface Asset {
  id: string;
  name: string;
  kind: Kind;
  format: Format;
  tags?: string[];
  wowdRef?: string;
  /**
   * The recipe of a procedural texture, kept in the asset's metadata rather than inside the PNG: an outside
   * editor re-saving the PNG would drop a text chunk, and <id>.json is untouched by that (spec 002).
   */
  procedural?: TextureParams;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a save carries besides the payload bytes. The bytes travel separately: how they are encoded on the
 * wire (base64 today) is the gateway's business, not the domain's.
 */
export interface SaveRequest {
  id?: string;
  name: string;
  kind: Kind;
  format: Format;
  tags?: string[];
  wowdRef?: string;
  procedural?: TextureParams;
}

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

/**
 * formatFor is the format a newly made asset of a kind is exported in. The switch is exhaustive without a
 * default on purpose: a new kind must decide its format here before the project compiles.
 */
export function formatFor(kind: Kind): Format {
  switch (kind) {
    case 'character':
    case 'creature':
    case 'item':
    case 'landscape':
      return 'glb';
    case 'texture':
      return 'png';
  }
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** validateName is the one rule the studio enforces before asking the server: an asset has a name. */
export function validateName(raw: string): NameCheck {
  const name = raw.trim();
  if (!name) return { ok: false, reason: 'give it a name first' };
  return { ok: true, name };
}

/** defaultName is what a fresh placeholder is called until the designer types something. */
export function defaultName(kind: Kind): string {
  return `${kind}_new`;
}

/**
 * isDefaultName tells a name the studio made up from one the designer typed, so an import may replace the
 * former with the file's name and must keep the latter (REQ-001-1).
 */
export function isDefaultName(name: string): boolean {
  return KINDS.some((kind) => name === defaultName(kind));
}

// A procedural texture is a recipe: a handful of numbers that always give the same pixels. The generator
// is a pure function so the recipe can be tested in Node without a canvas and reproduced anywhere (AGENTS.md,
// invariant 4: the only randomness is a PRNG seeded from the recipe itself).

export const TEXTURE_TYPES = ['checker', 'stripes', 'noise'] as const;
export type TextureType = (typeof TEXTURE_TYPES)[number];

/** Square powers of two only: what GPUs mip cleanly and what the payload limit comfortably holds. */
export const TEXTURE_SIZES = [256, 512, 1024] as const;
export type TextureSize = (typeof TEXTURE_SIZES)[number];

export interface TextureParams {
  readonly type: TextureType;
  readonly size: TextureSize;
  /** sRGB "#rrggbb". */
  readonly colorA: string;
  readonly colorB: string;
  /** Cells across the texture: checker squares, stripe pairs, noise lattice cells. */
  readonly scale: number;
  readonly seed: number;
}

export const DEFAULT_TEXTURE_PARAMS: TextureParams = {
  type: 'checker',
  size: 256,
  colorA: '#6b4f2a',
  colorB: '#3a5a40',
  scale: 8,
  seed: 1,
};

export const MAX_TEXTURE_SCALE = 256;
const MAX_SEED = 0xffffffff;

/** Rgba is decoded pixels, rows top first, four bytes per pixel — what a canvas' ImageData holds. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export function validTextureParams(p: TextureParams): boolean {
  return (
    isTextureType(p.type) &&
    isTextureSize(p.size) &&
    HEX_COLOUR.test(p.colorA) &&
    HEX_COLOUR.test(p.colorB) &&
    Number.isInteger(p.scale) &&
    p.scale >= 1 &&
    p.scale <= MAX_TEXTURE_SCALE &&
    Number.isInteger(p.seed) &&
    p.seed >= 0 &&
    p.seed <= MAX_SEED
  );
}

/**
 * parseTextureParams reads the recipe back from an asset's metadata. The server stores it as an opaque
 * object, so anything may be there: a recipe the studio cannot use is treated as no recipe rather than as
 * an error — the texture still opens as the picture it is.
 */
export function parseTextureParams(value: unknown): TextureParams | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const { type, size, colorA, colorB, scale, seed } = v;
  if (!isTextureType(type) || !isTextureSize(size)) return null;
  if (typeof colorA !== 'string' || typeof colorB !== 'string') return null;
  if (typeof scale !== 'number' || typeof seed !== 'number') return null;
  const params: TextureParams = { type, size, colorA, colorB, scale, seed };
  return validTextureParams(params) ? params : null;
}

export function isTextureType(value: unknown): value is TextureType {
  return typeof value === 'string' && (TEXTURE_TYPES as readonly string[]).includes(value);
}

export function isTextureSize(value: unknown): value is TextureSize {
  return typeof value === 'number' && (TEXTURE_SIZES as readonly number[]).includes(value);
}

export function generateTexture(p: TextureParams): Rgba {
  const a = rgb(p.colorA);
  const b = rgb(p.colorB);
  const size = p.size;
  const data = new Uint8ClampedArray(size * size * 4);
  const mix = mixer(p, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = mix(x, y);
      const i = (y * size + x) * 4;
      data[i] = a[0] + (b[0] - a[0]) * t;
      data[i + 1] = a[1] + (b[1] - a[1]) * t;
      data[i + 2] = a[2] + (b[2] - a[2]) * t;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** mixer returns, per pixel, how much of colour B goes into the pixel: 0 or 1 for patterns, in between for noise. */
function mixer(p: TextureParams, size: number): (x: number, y: number) => number {
  const cell = size / p.scale;
  switch (p.type) {
    case 'checker':
      return (x, y) => (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
    case 'stripes':
      return (x) => Math.floor(x / (cell / 2)) % 2;
    case 'noise': {
      // Value noise: a lattice of seeded random values, bilinearly interpolated with a smoothstep so the
      // cells do not show as squares. The lattice wraps, so the texture tiles.
      const n = p.scale;
      const lattice = new Float32Array(n * n);
      const next = mulberry32(p.seed);
      for (let i = 0; i < lattice.length; i++) lattice[i] = next();
      const at = (ix: number, iy: number): number => lattice[((iy % n) + n) % n * n + (((ix % n) + n) % n)] ?? 0;
      return (x, y) => {
        const gx = x / cell;
        const gy = y / cell;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = smooth(gx - ix);
        const fy = smooth(gy - iy);
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
        const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
        return top + (bottom - top) * fy;
      };
    }
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** mulberry32 is a small, fast, well-distributed PRNG; the seed is the whole state, which is the point. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

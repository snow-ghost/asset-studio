// @req-002-3
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEXTURE_PARAMS,
  TEXTURE_SIZES,
  TEXTURE_TYPES,
  generateTexture,
  parseTextureParams,
  validTextureParams,
  type TextureParams,
} from '../../src/domain/texture';

const base: TextureParams = { ...DEFAULT_TEXTURE_PARAMS, colorA: '#ff0000', colorB: '#0000ff', scale: 4 };

function pixel(rgba: ReturnType<typeof generateTexture>, x: number, y: number): number[] {
  const i = (y * rgba.width + x) * 4;
  return Array.from(rgba.data.slice(i, i + 4));
}

describe('generateTexture', () => {
  it.each(TEXTURE_TYPES)('%s: the same recipe gives the same pixels, at the recipe size, fully opaque', (type) => {
    const p = { ...base, type, size: 256 as const };
    const a = generateTexture(p);
    const b = generateTexture(p);
    expect(a.width).toBe(256);
    expect(a.height).toBe(256);
    expect(a.data).toEqual(b.data);
    for (let i = 3; i < a.data.length; i += 4 * 997) expect(a.data[i]).toBe(255);
  });

  it('checker alternates the two colours cell by cell', () => {
    const t = generateTexture({ ...base, type: 'checker', size: 256, scale: 4 }); // 64 px cells
    expect(pixel(t, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 64, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(t, 64, 64)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 63, 63)).toEqual([255, 0, 0, 255]);
  });

  it('stripes run vertically, two per cell', () => {
    const t = generateTexture({ ...base, type: 'stripes', size: 256, scale: 4 }); // 32 px stripes
    expect(pixel(t, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(t, 32, 200)).toEqual([0, 0, 255, 255]);
    expect(pixel(t, 0, 200)).toEqual(pixel(t, 0, 0));
  });

  it('noise depends on the seed and stays between the two colours', () => {
    const seven = generateTexture({ ...base, type: 'noise', seed: 7 });
    const eight = generateTexture({ ...base, type: 'noise', seed: 8 });
    const sevenAgain = generateTexture({ ...base, type: 'noise', seed: 7 });
    expect(seven.data).toEqual(sevenAgain.data);
    expect(seven.data).not.toEqual(eight.data);
    let distinct = new Set<number>();
    for (let i = 0; i < seven.data.length; i += 4) {
      distinct.add(seven.data[i] ?? 0);
      expect(seven.data[i + 1]).toBe(0); // red↔blue mix never invents green
    }
    expect(distinct.size).toBeGreaterThan(16); // a gradient, not a two-colour pattern
    distinct = new Set();
  });

  it.each(TEXTURE_SIZES)('renders %d pixels square', (size) => {
    const t = generateTexture({ ...base, size });
    expect(t.data.length).toBe(size * size * 4);
  });
});

describe('validTextureParams', () => {
  it('accepts the defaults', () => {
    expect(validTextureParams(DEFAULT_TEXTURE_PARAMS)).toBe(true);
  });

  it.each<[string, Partial<TextureParams>]>([
    ['an unknown type', { type: 'plaid' as never }],
    ['a size that is not offered', { size: 300 as never }],
    ['a named colour', { colorA: 'red' }],
    ['a zero scale', { scale: 0 }],
    ['a fractional scale', { scale: 2.5 }],
    ['a scale past the lattice limit', { scale: 257 }],
    ['a negative seed', { seed: -1 }],
    ['a fractional seed', { seed: 1.5 }],
  ])('refuses %s', (_label, patch) => {
    expect(validTextureParams({ ...DEFAULT_TEXTURE_PARAMS, ...patch })).toBe(false);
  });
});

describe('parseTextureParams', () => {
  it('round-trips through JSON as the metadata does', () => {
    const json = JSON.parse(JSON.stringify(DEFAULT_TEXTURE_PARAMS)) as unknown;
    expect(parseTextureParams(json)).toEqual(DEFAULT_TEXTURE_PARAMS);
  });

  it.each<unknown>([undefined, null, 'noise', 42, {}, { type: 'noise' }, { ...DEFAULT_TEXTURE_PARAMS, scale: '8' }, { ...DEFAULT_TEXTURE_PARAMS, size: 300 }])(
    'treats %o as no recipe',
    (value) => {
      expect(parseTextureParams(value)).toBeNull();
    },
  );
});

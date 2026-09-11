// @req-001-3 @req-001-5
import { describe, expect, it } from 'vitest';
import { IDENTITY, formatSize, validMaterial, validTransform } from '../../src/domain/model';

describe('validTransform', () => {
  it('accepts the identity and any finite transform with a positive scale', () => {
    expect(validTransform(IDENTITY)).toBe(true);
    expect(validTransform({ position: { x: -3, y: 0.5, z: 1e6 }, rotation: { x: 0, y: 720, z: -90 }, scale: { x: 0.001, y: 2, z: 3 } })).toBe(true);
  });

  it.each([
    ['zero scale', { ...IDENTITY, scale: { x: 1, y: 0, z: 1 } }],
    ['negative scale', { ...IDENTITY, scale: { x: 1, y: 1, z: -1 } }],
    ['NaN position', { ...IDENTITY, position: { x: 0, y: Number.NaN, z: 0 } }],
    ['infinite rotation', { ...IDENTITY, rotation: { x: 0, y: 0, z: Number.NEGATIVE_INFINITY } }],
  ])('refuses %s', (_label, t) => {
    expect(validTransform(t)).toBe(false);
  });
});

describe('validMaterial', () => {
  it('accepts a full hex colour and unit-interval factors', () => {
    expect(validMaterial({ color: '#8B5A2B', metalness: 0, roughness: 1 })).toBe(true);
  });

  it.each([
    ['a named colour', { color: 'red', metalness: 0, roughness: 0 }],
    ['a short hex', { color: '#fff', metalness: 0, roughness: 0 }],
    ['metalness above one', { color: '#ffffff', metalness: 1.01, roughness: 0 }],
    ['negative roughness', { color: '#ffffff', metalness: 0, roughness: -0.1 }],
    ['NaN', { color: '#ffffff', metalness: Number.NaN, roughness: 0 }],
  ])('refuses %s', (_label, m) => {
    expect(validMaterial(m)).toBe(false);
  });
});

describe('formatSize', () => {
  it('prints metres to one decimal in the panel order', () => {
    expect(formatSize({ x: 1, y: 1, z: 1.5 })).toBe('1.0 × 1.0 × 1.5 m');
    expect(formatSize({ x: 2, y: 2.04, z: 3 })).toBe('2.0 × 2.0 × 3.0 m');
  });
});

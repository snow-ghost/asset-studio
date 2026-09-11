// @req-000-1 @req-000-12 @req-001-1
import { describe, expect, it } from 'vitest';
import { KINDS, defaultName, formatFor, isDefaultName, isKind, validateName, type Format, type Kind } from '../../src/domain/asset';

describe('KINDS', () => {
  it('lists every member of the Kind union exactly once', () => {
    // A compile-time check: adding a kind to the union without listing it here fails to type-check.
    const everyKind: Record<Kind, true> = { character: true, creature: true, item: true, landscape: true, texture: true };
    expect([...KINDS].sort()).toEqual(Object.keys(everyKind).sort());
    expect(new Set(KINDS).size).toBe(KINDS.length);
  });

  it.each([
    ['creature', true],
    ['texture', true],
    ['dragon', false],
    ['', false],
    ['Creature', false],
  ])('isKind(%j) is %s', (value, want) => {
    expect(isKind(value)).toBe(want);
  });
});

describe('formatFor', () => {
  const table: Array<[Kind, Format]> = [
    ['character', 'glb'],
    ['creature', 'glb'],
    ['item', 'glb'],
    ['landscape', 'glb'],
    ['texture', 'png'],
  ];
  it.each(table)('a %s is exported as %s', (kind, format) => {
    expect(formatFor(kind)).toBe(format);
  });
  it('decides a format for every kind', () => {
    expect(table.map(([k]) => k).sort()).toEqual([...KINDS].sort());
  });
});

describe('validateName', () => {
  it('trims and accepts a real name', () => {
    expect(validateName('  moss_boar ')).toEqual({ ok: true, name: 'moss_boar' });
  });
  it.each(['', '   ', '\t\n'])('refuses %j with a reason the designer can act on', (raw) => {
    const check = validateName(raw);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('give it a name first');
  });
});

describe('defaultName', () => {
  it('names a fresh placeholder after its kind', () => {
    expect(defaultName('landscape')).toBe('landscape_new');
  });
});

describe('isDefaultName', () => {
  it('recognises the names the studio makes up, for every kind, and nothing else', () => {
    for (const kind of KINDS) expect(isDefaultName(defaultName(kind))).toBe(true);
    for (const typed of ['moss_boar', 'creature', 'creature_new_v2', '', 'CREATURE_NEW']) {
      expect(isDefaultName(typed)).toBe(false);
    }
  });
});

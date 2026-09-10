// @req-000-13
import { describe, expect, it } from 'vitest';
import { resolveApiBase, toBase64 } from '../../src/adapters/http/api';

describe('resolveApiBase', () => {
  it('uses an explicit VITE_STUDIO_API and drops a trailing slash', () => {
    expect(resolveApiBase({ VITE_STUDIO_API: 'http://studio.local:9000/', DEV: true })).toBe('http://studio.local:9000');
  });
  it('talks to studiod on its dev port under the Vite dev server', () => {
    expect(resolveApiBase({ DEV: true })).toBe('http://localhost:8099');
  });
  it('is same-origin in a production build, because studiod serves the app itself', () => {
    expect(resolveApiBase({ DEV: false })).toBe('');
    expect(resolveApiBase({})).toBe('');
  });
});

describe('toBase64', () => {
  it('round-trips a payload larger than one encoding chunk, binary bytes included', () => {
    const bytes = new Uint8Array(0x8000 * 3 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const decoded = atob(toBase64(bytes.buffer));
    expect(decoded.length).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i += 997) expect(decoded.charCodeAt(i)).toBe(bytes[i]);
    expect(decoded.charCodeAt(bytes.length - 1)).toBe(bytes[bytes.length - 1]);
  });
  it('encodes an empty buffer as an empty string', () => {
    expect(toBase64(new ArrayBuffer(0))).toBe('');
  });
});

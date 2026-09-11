// @req-001-1 @req-001-2 @req-001-8
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canImportModel, inspectModelFile, nameFromFile } from '../../src/domain/import';
import { MAX_PAYLOAD_BYTES, formatMiB } from '../../src/domain/limits';

const FIXTURES = new URL('../../../testdata/', import.meta.url);
function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(name, FIXTURES));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
function text(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

describe('inspectModelFile on the shared fixtures', () => {
  it.each([
    ['moss_boar.glb', 'glb'],
    ['moss_boar.gltf', 'gltf'],
  ])('accepts %s as %s', (file, format) => {
    expect(inspectModelFile(fixture(file), 'creature')).toEqual({ ok: true, format });
  });

  it.each([
    ['not-a-model.bin', 'not a glTF file'],
    ['external.gltf', 'external files (moss_boar.bin, moss_boar.png)'],
    ['draco.gltf', 'KHR_draco_mesh_compression'],
  ])('refuses %s mentioning %s', (file, reason) => {
    const verdict = inspectModelFile(fixture(file), 'creature');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain(reason);
  });
});

describe('inspectModelFile rules', () => {
  it('refuses any glTF under the texture kind, before looking at the bytes', () => {
    expect(canImportModel('texture')).toBe(false);
    const verdict = inspectModelFile(fixture('moss_boar.glb'), 'texture');
    expect(verdict).toMatchObject({ ok: false });
    if (!verdict.ok) expect(verdict.reason).toContain('PNG');
  });

  it('refuses a file over the limit and names both sizes', () => {
    const verdict = inspectModelFile(new ArrayBuffer(3 * 1024 * 1024), 'creature', 2 * 1024 * 1024);
    expect(verdict).toEqual({ ok: false, reason: 'the file is 3 MiB; the limit is 2 MiB' });
  });

  it('accepts a bare glTF JSON with only embedded data', () => {
    const json = { asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AA==' }] };
    expect(inspectModelFile(text(JSON.stringify(json)), 'item')).toEqual({ ok: true, format: 'gltf' });
  });

  it.each([
    ['JSON without asset.version', '{"scenes":[]}'],
    ['JSON that is not an object', '[1,2,3]'],
    ['text that is not JSON', 'hello'],
    ['an empty file', ''],
  ])('refuses %s as not glTF', (_label, body) => {
    const verdict = inspectModelFile(text(body), 'creature');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('not a glTF');
  });

  it('refuses a GLB whose first chunk is not JSON', () => {
    const bytes = new ArrayBuffer(20);
    const view = new DataView(bytes);
    view.setUint32(0, 0x46546c67, true); // glTF
    view.setUint32(4, 2, true);
    view.setUint32(8, 20, true);
    view.setUint32(12, 0, true);
    view.setUint32(16, 0x004e4942, true); // BIN chunk first
    expect(inspectModelFile(bytes, 'creature').ok).toBe(false);
  });

  it('treats meshopt as compression too', () => {
    const json = { asset: { version: '2.0' }, extensionsRequired: ['EXT_meshopt_compression'] };
    const verdict = inspectModelFile(text(JSON.stringify(json)), 'creature');
    if (!verdict.ok) expect(verdict.reason).toContain('EXT_meshopt_compression');
    expect(verdict.ok).toBe(false);
  });

  it('lets an image in a bufferView pass and flags one with a relative uri', () => {
    const embedded = { asset: { version: '2.0' }, images: [{ bufferView: 0 }] };
    expect(inspectModelFile(text(JSON.stringify(embedded)), 'creature').ok).toBe(true);
    const external = { asset: { version: '2.0' }, images: [{ uri: 'skin.png' }] };
    const verdict = inspectModelFile(text(JSON.stringify(external)), 'creature');
    if (!verdict.ok) expect(verdict.reason).toContain('skin.png');
    expect(verdict.ok).toBe(false);
  });
});

describe('nameFromFile', () => {
  it.each([
    ['moss_boar.glb', 'moss_boar'],
    ['C:\\models\\Mossy Boar.v2.gltf', 'Mossy Boar.v2'],
    ['/tmp/boar', 'boar'],
    ['.hidden', '.hidden'],
  ])('%s → %s', (file, name) => {
    expect(nameFromFile(file)).toBe(name);
  });
});

describe('the payload limit is one number for both sides', () => {
  it('matches testdata/limits.json, which the server test reads too', () => {
    const shared = JSON.parse(readFileSync(new URL('limits.json', FIXTURES), 'utf-8')) as { maxPayloadBytes: number };
    expect(MAX_PAYLOAD_BYTES).toBe(shared.maxPayloadBytes);
  });

  it.each([
    [64 * 1024 * 1024, '64 MiB'],
    [1024 * 1024, '1 MiB'],
    [1.5 * 1024 * 1024, '1.5 MiB'],
  ])('formats %d bytes as %s like the server does', (bytes, label) => {
    expect(formatMiB(bytes)).toBe(label);
  });
});

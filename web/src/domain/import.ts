// The rules of taking a model file in. Everything here is decided from the bytes and the file name, before
// three.js parses anything: a designer gets the reason for a refusal in one sentence, and the same checks
// run in Node under Vitest with the fixtures in testdata/.

import type { Kind } from './asset';
import { MAX_PAYLOAD_BYTES, formatMiB } from './limits';

export type ImportFormat = 'glb' | 'gltf';
export type ImportVerdict = { ok: true; format: ImportFormat } | { ok: false; reason: string };

// "glTF" and "JSON" as little-endian uint32, as the GLB container spec writes them.
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

/**
 * Extensions the studio would have to decode to show the model. It has no decoder (no Draco, no meshopt),
 * and the same three.js in wowd's client has none either, so accepting such a file would store something
 * the game cannot load.
 */
const COMPRESSION_EXTENSIONS = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'];

/** The parts of a glTF document the import rules look at. Everything else is the loader's business. */
interface GltfDocument {
  asset?: { version?: unknown };
  extensionsRequired?: unknown;
  buffers?: { uri?: unknown }[];
  images?: { uri?: unknown; bufferView?: unknown }[];
}

/** Only model kinds import glTF; a texture is a PNG and arrives another way (M2). */
export function canImportModel(kind: Kind): boolean {
  return kind !== 'texture';
}

/** nameFromFile is the default asset name: the file's base name without its extension. */
export function nameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function inspectModelFile(bytes: ArrayBuffer, kind: Kind, limit = MAX_PAYLOAD_BYTES): ImportVerdict {
  if (!canImportModel(kind)) {
    return refuse('textures are loaded as PNG, not as glTF — pick a model kind to import a model');
  }
  if (bytes.byteLength > limit) {
    return refuse(`the file is ${formatMiB(bytes.byteLength)}; the limit is ${formatMiB(limit)}`);
  }
  const parsed = parseGltf(bytes);
  if (!parsed) {
    return refuse('not a glTF file: neither a GLB header nor glTF JSON');
  }
  const required = Array.isArray(parsed.doc.extensionsRequired) ? parsed.doc.extensionsRequired : [];
  const compression = required.find((e): e is string => typeof e === 'string' && COMPRESSION_EXTENSIONS.includes(e));
  if (compression) {
    return refuse(`the model requires ${compression} compression, which the studio does not decode`);
  }
  const external = externalReferences(parsed.doc, parsed.format);
  if (external.length > 0) {
    return refuse(`the file references external files (${external.join(', ')}); pack it as a GLB`);
  }
  return { ok: true, format: parsed.format };
}

function refuse(reason: string): ImportVerdict {
  return { ok: false, reason };
}

/** parseGltf recognises a GLB by its header and a .gltf by being JSON with asset.version; anything else is not glTF. */
function parseGltf(bytes: ArrayBuffer): { doc: GltfDocument; format: ImportFormat } | null {
  const glb = readGlbJson(bytes);
  if (glb !== null) {
    const doc = asGltf(glb);
    return doc ? { doc, format: 'glb' } : null;
  }
  const doc = asGltf(decodeText(bytes));
  return doc ? { doc, format: 'gltf' } : null;
}

function readGlbJson(bytes: ArrayBuffer): string | null {
  if (bytes.byteLength < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) return null;
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  const length = view.getUint32(GLB_HEADER_BYTES, true);
  const type = view.getUint32(GLB_HEADER_BYTES + 4, true);
  const start = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (type !== CHUNK_JSON || start + length > bytes.byteLength) return null;
  return decodeText(bytes.slice(start, start + length));
}

function decodeText(bytes: ArrayBuffer): string | null {
  try {
    // fatal: a binary file is not text, and pretending it is would only move the failure into JSON.parse.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function asGltf(text: string | null): GltfDocument | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const doc = value as GltfDocument;
  return typeof doc.asset?.version === 'string' ? doc : null;
}

/**
 * externalReferences lists every uri that is not embedded. In a GLB the first buffer has no uri (it is the
 * BIN chunk); an image may live in a bufferView instead of a uri. Everything else must be a data: URI,
 * because the studio stores one file per asset and would have nowhere to put a second one.
 */
function externalReferences(doc: GltfDocument, format: ImportFormat): string[] {
  const out: string[] = [];
  (doc.buffers ?? []).forEach((b, i) => {
    if (b.uri === undefined && format === 'glb' && i === 0) return;
    if (typeof b.uri !== 'string' || !b.uri.startsWith('data:')) out.push(typeof b.uri === 'string' ? b.uri : `buffer ${i}`);
  });
  (doc.images ?? []).forEach((img, i) => {
    if (img.bufferView !== undefined) return;
    if (typeof img.uri !== 'string' || !img.uri.startsWith('data:')) out.push(typeof img.uri === 'string' ? img.uri : `image ${i}`);
  });
  return out;
}

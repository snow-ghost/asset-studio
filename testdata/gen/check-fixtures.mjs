// Verifies the generated fixtures against the numbers the scenarios in features/editor rely on. It reads
// the files back the way a loader would — header, chunks, accessors against buffers — rather than
// trusting the generator, so a change to make-fixtures.mjs that silently shifts a count fails here, not
// in a browser test three layers away.
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECT = {
  meshes: 3,
  vertices: 48,
  indices: 60,
  min: [-0.5, 0, -0.75],
  max: [0.5, 1, 0.75],
  materials: 2,
  textures: 1,
  images: 1,
  animations: 1,
};

const failures = [];
function check(ok, what) {
  if (!ok) failures.push(what);
}
function near(a, b) {
  return Math.abs(a - b) < 1e-6;
}

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(dv.getUint32(0, true) === 0x46546c67, 'glb: magic is not glTF');
  check(dv.getUint32(4, true) === 2, 'glb: version is not 2');
  check(dv.getUint32(8, true) === bytes.length, 'glb: header length differs from file length');
  const jsonLen = dv.getUint32(12, true);
  check(dv.getUint32(16, true) === 0x4e4f534a, 'glb: first chunk is not JSON');
  check(jsonLen % 4 === 0, 'glb: JSON chunk is not 4-byte aligned');
  const json = JSON.parse(Buffer.from(bytes.subarray(20, 20 + jsonLen)).toString('utf8'));
  const binStart = 20 + jsonLen;
  const binLen = dv.getUint32(binStart, true);
  check(dv.getUint32(binStart + 4, true) === 0x004e4942, 'glb: second chunk is not BIN');
  check(binStart + 8 + binLen === bytes.length, 'glb: BIN chunk does not end the file');
  const bin = bytes.subarray(binStart + 8, binStart + 8 + binLen);
  check(json.buffers[0].byteLength <= bin.length, 'glb: buffer longer than BIN chunk');
  return { json, bin };
}

function dataUriBytes(uri) {
  const comma = uri.indexOf(',');
  return Buffer.from(uri.slice(comma + 1), 'base64');
}

// Reads one accessor as numbers, checking that it fits its view and the view fits the buffer.
function readAccessor(json, bin, index, label) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const comp = COMPONENT_BYTES[acc.componentType];
  const size = TYPE_SIZE[acc.type];
  const byteLength = acc.count * comp * size;
  const accOffset = acc.byteOffset ?? 0;
  check(view.byteOffset % 4 === 0, `${label}: bufferView not 4-byte aligned`);
  check(accOffset + byteLength <= view.byteLength, `${label}: accessor overruns its bufferView`);
  check(view.byteOffset + view.byteLength <= json.buffers[view.buffer].byteLength, `${label}: bufferView overruns buffer`);
  const start = view.byteOffset + accOffset;
  const dv = new DataView(bin.buffer, bin.byteOffset + start, byteLength);
  const out = [];
  for (let i = 0; i < acc.count * size; i++) {
    out.push(acc.componentType === 5126 ? dv.getFloat32(i * 4, true) : dv.getUint16(i * 2, true));
  }
  return { acc, values: out };
}

function checkModel(json, bin, label) {
  check(json.asset?.version === '2.0', `${label}: asset.version`);
  check(json.meshes.length === EXPECT.meshes, `${label}: ${json.meshes.length} meshes, want ${EXPECT.meshes}`);
  let vertices = 0;
  let indices = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const pos = readAccessor(json, bin, p.attributes.POSITION, `${label}/${m.name} POSITION`);
      readAccessor(json, bin, p.attributes.NORMAL, `${label}/${m.name} NORMAL`);
      readAccessor(json, bin, p.attributes.TEXCOORD_0, `${label}/${m.name} TEXCOORD_0`);
      const idx = readAccessor(json, bin, p.indices, `${label}/${m.name} indices`);
      vertices += pos.acc.count;
      indices += idx.acc.count;
      check(idx.values.every((i) => i < pos.acc.count), `${label}/${m.name}: index out of range`);
      for (let i = 0; i < pos.values.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], pos.values[i + k]);
          max[k] = Math.max(max[k], pos.values[i + k]);
        }
      }
      check(pos.acc.min && pos.acc.max, `${label}/${m.name}: POSITION lacks min/max`);
    }
  }
  check(vertices === EXPECT.vertices, `${label}: ${vertices} vertices, want ${EXPECT.vertices}`);
  check(indices === EXPECT.indices, `${label}: ${indices} indices, want ${EXPECT.indices}`);
  check(min.every((v, i) => near(v, EXPECT.min[i])), `${label}: bbox min ${min}, want ${EXPECT.min}`);
  check(max.every((v, i) => near(v, EXPECT.max[i])), `${label}: bbox max ${max}, want ${EXPECT.max}`);
  check(json.materials.length === EXPECT.materials, `${label}: materials`);
  check((json.textures ?? []).length === EXPECT.textures, `${label}: textures`);
  check((json.images ?? []).length === EXPECT.images, `${label}: images`);
  check((json.animations ?? []).length === EXPECT.animations, `${label}: animations`);
  const byName = Object.fromEntries(json.meshes.map((m) => [m.name, m]));
  check(byName.tusk_left && byName.tusk_right && byName.body, `${label}: mesh names`);
  check(byName.tusk_left?.primitives[0].material === byName.tusk_right?.primitives[0].material,
    `${label}: tusks do not share a material`);
  check(byName.body?.primitives[0].material !== byName.tusk_left?.primitives[0].material,
    `${label}: body shares the tusks' material`);
  check(json.materials[byName.body?.primitives[0].material]?.pbrMetallicRoughness?.baseColorTexture?.index === 0,
    `${label}: body material has no texture`);
  const anim = json.animations[0];
  check(anim.name === 'idle' && anim.channels[0].target.path === 'translation', `${label}: animation shape`);
  readAccessor(json, bin, anim.samplers[0].input, `${label}/anim input`);
  readAccessor(json, bin, anim.samplers[0].output, `${label}/anim output`);
  check(json.scenes[0].nodes.length === 3, `${label}: expected three root nodes`);
  return { vertices, indices };
}

function checkPng(bytes, label) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  check(sig.every((b, i) => bytes[i] === b), `${label}: PNG signature`);
  check(Buffer.from(bytes.subarray(12, 16)).toString('ascii') === 'IHDR', `${label}: IHDR`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  check(dv.getUint32(16) === 2 && dv.getUint32(20) === 2, `${label}: PNG is not 2×2`);
}

// --- moss_boar.glb
const glbBytes = readFileSync(join(DIR, 'moss_boar.glb'));
const { json: glbJson, bin } = parseGlb(glbBytes);
const stats = checkModel(glbJson, bin, 'glb');
const imgView = glbJson.bufferViews[glbJson.images[0].bufferView];
check(glbJson.images[0].mimeType === 'image/png', 'glb: image mimeType');
checkPng(bin.subarray(imgView.byteOffset, imgView.byteOffset + imgView.byteLength), 'glb image');

// --- moss_boar.gltf: same model, every uri is data:
const gltfJson = JSON.parse(readFileSync(join(DIR, 'moss_boar.gltf'), 'utf8'));
const uris = [...gltfJson.buffers, ...gltfJson.images].map((x) => x.uri);
check(uris.length === 2 && uris.every((u) => typeof u === 'string' && u.startsWith('data:')), 'gltf: not every uri is data:');
const gltfBin = dataUriBytes(gltfJson.buffers[0].uri);
check(gltfBin.length === gltfJson.buffers[0].byteLength, 'gltf: buffer byteLength differs from data uri');
checkModel(gltfJson, gltfBin, 'gltf');
checkPng(dataUriBytes(gltfJson.images[0].uri), 'gltf image');

// --- external.gltf: references files that must not exist
const ext = JSON.parse(readFileSync(join(DIR, 'external.gltf'), 'utf8'));
check(!ext.buffers[0].uri.startsWith('data:'), 'external: buffer uri is data:');
check(!existsSync(join(DIR, ext.buffers[0].uri)), `external: ${ext.buffers[0].uri} exists but must not`);
check(!existsSync(join(DIR, ext.images[0].uri)), `external: ${ext.images[0].uri} exists but must not`);

// --- draco.gltf: requires a compression extension
const draco = JSON.parse(readFileSync(join(DIR, 'draco.gltf'), 'utf8'));
check(draco.asset?.version === '2.0', 'draco: asset.version');
check(draco.extensionsRequired?.includes('KHR_draco_mesh_compression'), 'draco: extension not required');
check(!!draco.meshes[0].primitives[0].extensions?.KHR_draco_mesh_compression, 'draco: primitive lacks the extension');

// --- not-a-model.bin
const junk = readFileSync(join(DIR, 'not-a-model.bin'));
check(junk.length === 256, 'junk: length');
check(junk[0] === 0xff, 'junk: first byte must be 0xFF');
check(junk.subarray(0, 4).toString('latin1') !== 'glTF', 'junk: starts with glTF');
let junkIsJson = false;
try {
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(junk));
  junkIsJson = true;
} catch {
  // expected: neither valid UTF-8 nor JSON
}
check(!junkIsJson, 'junk: parses as JSON');

// --- bark_diffuse.png: a standalone 64×64 RGBA texture that really decodes
const BARK = 64;
const bark = readFileSync(join(DIR, 'bark_diffuse.png'));
{
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  check(sig.every((b, i) => bark[i] === b), 'bark: PNG signature');
  // Walk the chunks: IHDR first, then collect IDAT, stop at IEND.
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let sawEnd = false;
  while (pos + 8 <= bark.length && !sawEnd) {
    const len = bark.readUInt32BE(pos);
    const type = bark.subarray(pos + 4, pos + 8).toString('ascii');
    const data = bark.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') sawEnd = true;
    pos += 12 + len;
  }
  check(sawEnd, 'bark: no IEND chunk');
  check(ihdr !== null && ihdr.readUInt32BE(0) === BARK && ihdr.readUInt32BE(4) === BARK, 'bark: IHDR is not 64×64');
  check(ihdr !== null && ihdr[8] === 8 && ihdr[9] === 6, 'bark: not 8-bit RGBA');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = BARK * 4 + 1;
  check(raw.length === BARK * stride, `bark: decoded ${raw.length} bytes, want ${BARK * stride}`);
  let rowsIdentical = 0;
  const colours = new Set();
  for (let y = 0; y < BARK; y++) {
    check(raw[y * stride] === 0, `bark: row ${y} uses a filter other than None`);
    for (let x = 0; x < BARK; x++) {
      const o = y * stride + 1 + x * 4;
      check(raw[o + 3] === 255, `bark: pixel ${x},${y} is not opaque`);
      colours.add((raw[o] << 16) | (raw[o + 1] << 8) | raw[o + 2]);
    }
    if (y > 0 && raw.subarray(y * stride, (y + 1) * stride).equals(raw.subarray((y - 1) * stride, y * stride))) rowsIdentical++;
  }
  check(rowsIdentical === 0, `bark: ${rowsIdentical} pairs of adjacent rows are identical`);
  check(colours.size >= 100, `bark: only ${colours.size} distinct colours`);
}

if (failures.length) {
  console.error('fixtures: FAILED');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log(
  `fixtures ok: meshes=${glbJson.meshes.length} vertices=${stats.vertices} indices=${stats.indices} ` +
    `bbox=[${EXPECT.min}]..[${EXPECT.max}] materials=${glbJson.materials.length} textures=${glbJson.textures.length} ` +
    `images=${glbJson.images.length} animations=${glbJson.animations.length} glb=${glbBytes.length}B ` +
    `bark_diffuse=${BARK}x${BARK} png=${bark.length}B`,
);

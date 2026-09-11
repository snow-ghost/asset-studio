// Generates the studio's test models. Everything here is hand-built glTF 2.0 with no library, because
// the fixtures exist to check the studio's own glTF path (import → edit → export → import); building them
// with the same three.js code they test would prove nothing. The output is byte-identical on every run
// (no timestamps, fixed key order, seeded PRNG for the junk file), so a diff in git means the content
// changed on purpose.
//
// Usage: node testdata/gen/make-fixtures.mjs && node testdata/gen/check-fixtures.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------------
// Colour. glTF stores baseColorFactor in linear space; the studio's panel shows sRGB hex. The scenarios
// assert the hex, so the fixture must carry the exact linear value of that hex.
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function linearFactor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Number(srgbToLinear(((n >> shift) & 0xff) / 255).toFixed(6));
  return [ch(16), ch(8), ch(0), 1];
}
const HIDE_HEX = '#8b5a2b';
const BONE_HEX = '#e8e2d0';

// ---------------------------------------------------------------------------------------------------
// Geometry helpers: flat-shaded, one vertex per face corner so normals are per face.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v) => {
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
};

// A face is a list of corners; `outward` is a point the normal must point away from, so the winding is
// fixed by geometry instead of by hand — the one place a hand-written mesh usually goes wrong.
function face(corners, outward) {
  let n = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]));
  const centre = corners.reduce((acc, c) => acc.map((x, i) => x + c[i] / corners.length), [0, 0, 0]);
  if (dot(n, sub(centre, outward)) < 0) {
    corners = [...corners].reverse();
    n = n.map((x) => -x);
  }
  return { corners, normal: normalize(n) };
}

function mesh(faces) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const quadUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const triUV = [[0, 0], [1, 0], [0.5, 1]];
  for (const f of faces) {
    const base = positions.length / 3;
    const uvSet = f.corners.length === 4 ? quadUV : triUV;
    f.corners.forEach((c, i) => {
      positions.push(...c);
      normals.push(...f.normal);
      uvs.push(...uvSet[i]);
    });
    for (let i = 1; i + 1 < f.corners.length; i++) indices.push(base, base + i, base + i + 1);
  }
  return { positions, normals, uvs, indices };
}

// body: a 1.0 × 1.0 × 1.25 m box standing on the ground, from z = -0.75 to z = 0.5. The tusks stick out
// of its front face to z = 0.75, so the whole model measures 1.0 × 1.0 × 1.5 m — the number the scenarios
// assert — and a tusk is something a ray can hit first, which the material scenarios need when they click
// one. A tusk hidden inside the body would be unselectable by any real click.
function cube() {
  const [hx, y0, y1, z0, z1] = [0.5, 0, 1, -0.75, 0.5];
  const centre = [0, 0.5, (z0 + z1) / 2];
  const quads = [
    [[hx, y0, z0], [hx, y1, z0], [hx, y1, z1], [hx, y0, z1]],
    [[-hx, y0, z0], [-hx, y1, z0], [-hx, y1, z1], [-hx, y0, z1]],
    [[-hx, y1, z0], [hx, y1, z0], [hx, y1, z1], [-hx, y1, z1]],
    [[-hx, y0, z0], [hx, y0, z0], [hx, y0, z1], [-hx, y0, z1]],
    [[-hx, y0, z1], [hx, y0, z1], [hx, y1, z1], [-hx, y1, z1]],
    [[-hx, y0, z0], [hx, y0, z0], [hx, y1, z0], [-hx, y1, z0]],
  ];
  return mesh(quads.map((q) => face(q, centre)));
}

// tusk: a tetrahedron rooted inside the body (z = 0.45) and protruding through its front face to
// z = 0.75 — the model's full depth.
function tetra(cx) {
  const a = [cx - 0.1, 0.3, 0.45];
  const b = [cx + 0.1, 0.3, 0.45];
  const c = [cx, 0.3, 0.75];
  const d = [cx, 0.6, 0.55];
  const centre = [cx, 0.375, 0.55];
  return mesh([[a, b, c], [a, b, d], [b, c, d], [c, a, d]].map((t) => face(t, centre)));
}

// ---------------------------------------------------------------------------------------------------
// PNG: a 2×2 RGBA checker, written by hand so the fixture has an embedded texture without depending on
// an image library.
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}
// encodePng writes an 8-bit RGBA PNG with filter None on every scanline: the simplest valid PNG, and one
// whose pixels a checker can read back with inflate alone. png2x2 below predates it and keeps its own body
// so the bytes embedded in the committed moss_boar files stay exactly as they are.
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter None
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// barkDiffuse is the standalone texture fixture for spec 002: 64 × 64, opaque, bark-like vertical streaks
// from a seeded PRNG in browns, with per-pixel grain so no two rows are alike and a pixel-equality check
// in the browser has something to bite on. Original content (invariant 8).
function barkDiffuse() {
  const size = 64;
  const rand = mulberry32(0xba2c);
  const rgba = Buffer.alloc(size * size * 4);
  // One base tone per column, drifting slowly so the streaks read as bark rather than as stripes.
  const columns = [];
  let tone = 0.5;
  for (let x = 0; x < size; x++) {
    tone = Math.min(1, Math.max(0, tone + (rand() - 0.5) * 0.35));
    columns.push(tone);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = (rand() - 0.5) * 0.25;
      const t = Math.min(1, Math.max(0, columns[x] + grain));
      // Between a dark umber and a lighter tan.
      const r = Math.round(70 + t * 100);
      const g = Math.round(42 + t * 70);
      const b = Math.round(22 + t * 40);
      rgba.set([r, g, b, 255], (y * size + x) * 4);
    }
  }
  return encodePng(size, size, rgba);
}

function png2x2() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const brown = [0x8b, 0x5a, 0x2b, 0xff];
  const dark = [0x5a, 0x3a, 0x1a, 0xff];
  // Each scanline starts with filter byte 0 (None).
  const raw = Buffer.from([0, ...brown, ...dark, 0, ...dark, ...brown]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------------
// glTF assembly. One bufferView per accessor, each 4-byte aligned: simple to read back and to check.
const FLOAT = 5126;
const USHORT = 5123;

class BufferBuilder {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.views = [];
  }
  pad() {
    const rem = this.length % 4;
    if (rem) {
      this.parts.push(Buffer.alloc(4 - rem));
      this.length += 4 - rem;
    }
  }
  view(bytes, extra = {}) {
    this.pad();
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...extra });
    this.parts.push(bytes);
    this.length += bytes.length;
    return this.views.length - 1;
  }
  bytes() {
    this.pad();
    return Buffer.concat(this.parts);
  }
}

function floats(values) {
  const b = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
}
function ushorts(values) {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}
function minMax(values, size) {
  const min = Array(size).fill(Infinity);
  const max = Array(size).fill(-Infinity);
  for (let i = 0; i < values.length; i += size) {
    for (let k = 0; k < size; k++) {
      min[k] = Math.min(min[k], values[i + k]);
      max[k] = Math.max(max[k], values[i + k]);
    }
  }
  return { min, max };
}

function build() {
  const buf = new BufferBuilder();
  const accessors = [];
  const accessor = (viewIndex, componentType, count, type, extra = {}) => {
    accessors.push({ bufferView: viewIndex, componentType, count, type, ...extra });
    return accessors.length - 1;
  };

  const meshes = [];
  const addMesh = (name, geo, material) => {
    const idx = accessor(buf.view(ushorts(geo.indices), { target: 34963 }), USHORT, geo.indices.length, 'SCALAR');
    const pos = accessor(buf.view(floats(geo.positions), { target: 34962 }), FLOAT, geo.positions.length / 3, 'VEC3',
      minMax(geo.positions, 3));
    const nrm = accessor(buf.view(floats(geo.normals), { target: 34962 }), FLOAT, geo.normals.length / 3, 'VEC3');
    const uv = accessor(buf.view(floats(geo.uvs), { target: 34962 }), FLOAT, geo.uvs.length / 2, 'VEC2');
    meshes.push({
      name,
      primitives: [{ attributes: { POSITION: pos, NORMAL: nrm, TEXCOORD_0: uv }, indices: idx, material, mode: 4 }],
    });
    return meshes.length - 1;
  };
  addMesh('body', cube(), 0);
  addMesh('tusk_left', tetra(-0.25), 1);
  addMesh('tusk_right', tetra(0.25), 1);

  // Animation: the body bobs 5 cm over one second. Enough to prove an export kept the clip.
  const times = [0, 1];
  const values = [0, 0, 0, 0, 0.05, 0];
  const input = accessor(buf.view(floats(times)), FLOAT, 2, 'SCALAR', minMax(times, 1));
  const output = accessor(buf.view(floats(values)), FLOAT, 2, 'VEC3');

  const core = {
    asset: { version: '2.0', generator: 'asset-studio testdata/gen' },
    scene: 0,
    scenes: [{ nodes: [0, 1, 2] }],
    // Three root nodes on purpose: an exporter that wraps them under one node changes the tree shape,
    // and the studio's import must cope with both shapes.
    nodes: [
      { name: 'body', mesh: 0 },
      { name: 'tusk_left', mesh: 1 },
      { name: 'tusk_right', mesh: 2 },
    ],
    meshes,
    materials: [
      {
        name: 'hide',
        pbrMetallicRoughness: {
          baseColorFactor: linearFactor(HIDE_HEX),
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.9,
        },
      },
      {
        name: 'bone',
        pbrMetallicRoughness: { baseColorFactor: linearFactor(BONE_HEX), metallicFactor: 0.1, roughnessFactor: 0.6 },
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 }],
    animations: [
      {
        name: 'idle',
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
        samplers: [{ input, output, interpolation: 'LINEAR' }],
      },
    ],
    accessors,
  };
  return { core, buf };
}

// ---------------------------------------------------------------------------------------------------
// Containers.
function glb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([Buffer.alloc(8), jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  jsonChunk.writeUInt32LE(jsonBytes.length + jsonPad, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binChunk = Buffer.concat([Buffer.alloc(8), bin, Buffer.alloc(binPad)]);
  binChunk.writeUInt32LE(bin.length + binPad, 0);
  binChunk.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8);
  return Buffer.concat([header, jsonChunk, binChunk]);
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const { core, buf } = build();
  const image = png2x2();

  // moss_boar.glb: geometry, animation and the PNG all in the BIN chunk.
  const glbJson = structuredClone(core);
  const glbBuf = new BufferBuilder();
  glbBuf.parts = [...buf.parts];
  glbBuf.length = buf.length;
  glbBuf.views = [...buf.views];
  const imageView = glbBuf.view(image);
  const glbBin = glbBuf.bytes();
  glbJson.bufferViews = glbBuf.views;
  glbJson.buffers = [{ byteLength: glbBin.length }];
  glbJson.images = [{ bufferView: imageView, mimeType: 'image/png', name: 'hide_diffuse' }];
  writeFileSync(join(OUT, 'moss_boar.glb'), glb(glbJson, glbBin));

  // moss_boar.gltf: the same model self-contained — every uri is data:, nothing on disk beside it.
  const coreBin = buf.bytes();
  const gltfJson = structuredClone(core);
  gltfJson.bufferViews = buf.views;
  gltfJson.buffers = [{ byteLength: coreBin.length, uri: `data:application/octet-stream;base64,${coreBin.toString('base64')}` }];
  gltfJson.images = [{ uri: `data:image/png;base64,${image.toString('base64')}`, name: 'hide_diffuse' }];
  writeFileSync(join(OUT, 'moss_boar.gltf'), JSON.stringify(gltfJson, null, 2) + '\n');

  // external.gltf: the same JSON pointing at files that do not exist — what the studio must refuse,
  // because a glTF that needs its neighbours is not a file the game can be handed on its own.
  const externalJson = structuredClone(gltfJson);
  externalJson.buffers[0].uri = 'moss_boar.bin';
  externalJson.images[0].uri = 'moss_boar.png';
  writeFileSync(join(OUT, 'external.gltf'), JSON.stringify(externalJson, null, 2) + '\n');

  // draco.gltf: requires a compression extension the studio does not decode. The primitive is a stub —
  // the point is that extensionsRequired is honoured before any decoding is attempted.
  const dracoJson = {
    asset: { version: '2.0', generator: 'asset-studio testdata/gen' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'compressed', mesh: 0 }],
    meshes: [
      {
        name: 'compressed',
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4,
            extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
          },
        ],
      },
    ],
    accessors: [
      { componentType: FLOAT, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { componentType: USHORT, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }],
    buffers: [{ byteLength: 16, uri: `data:application/octet-stream;base64,${Buffer.alloc(16, 0x44).toString('base64')}` }],
  };
  writeFileSync(join(OUT, 'draco.gltf'), JSON.stringify(dracoJson, null, 2) + '\n');

  // not-a-model.bin: 256 bytes of seeded noise. The first byte is 0xFF, which no GLB (magic 'glTF') and
  // no UTF-8 JSON can start with.
  const rand = mulberry32(0x6d0553);
  const junk = Buffer.alloc(256);
  for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(rand() * 256);
  junk[0] = 0xff;
  writeFileSync(join(OUT, 'not-a-model.bin'), junk);

  // bark_diffuse.png: the standalone texture the spec 002 scenarios import, assign and round-trip.
  writeFileSync(join(OUT, 'bark_diffuse.png'), barkDiffuse());

  console.log(`hide baseColorFactor ${JSON.stringify(linearFactor(HIDE_HEX))} (${HIDE_HEX})`);
  console.log(`bone baseColorFactor ${JSON.stringify(linearFactor(BONE_HEX))} (${BONE_HEX})`);
}

main();

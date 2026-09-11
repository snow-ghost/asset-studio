import * as THREE from 'three';
import type { Vec3 } from '../../domain/model';

// Reading a model: the pure helpers behind the editor's stats, material and texture accessors, kept apart
// so editor.ts stays a façade over the gizmo and the picking rather than a pile of geometry maths.

/** Editable is the metallic-roughness family glTF describes; anything else (unlit, lines) has no such knobs. */
export type Editable = THREE.MeshStandardMaterial;

export function asArray(m: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(m) ? m : [m];
}

export function firstOf(m: THREE.Material | THREE.Material[]): THREE.Material | undefined {
  return Array.isArray(m) ? m[0] : m;
}

export function editable(m: THREE.Material | undefined): Editable | null {
  return m instanceof THREE.MeshStandardMaterial ? m : null;
}

/** texturesOf lists the distinct textures a material samples, across every slot glTF may carry. */
export function texturesOf(m: THREE.Material): THREE.Texture[] {
  if (m instanceof THREE.MeshStandardMaterial) {
    return [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap, m.aoMap].filter(
      (t): t is THREE.Texture => t !== null,
    );
  }
  if (m instanceof THREE.MeshBasicMaterial && m.map) return [m.map];
  return [];
}

/**
 * localSize is the model's own dimensions: its bounds in the root's frame, times the root's scale. The
 * world-space box would grow when the model is turned, and a boar is as long facing east as facing north.
 */
export function localSize(root: THREE.Object3D, meshes: THREE.Mesh[]): Vec3 {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    if (bounds) box.union(bounds.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(toRoot));
  }
  if (box.isEmpty()) return { x: 0, y: 0, z: 0 };
  const size = box.getSize(new THREE.Vector3()).multiply(root.scale);
  return { x: size.x, y: size.y, z: size.z };
}

/** tidy rounds away floating-point noise (a 90° turn reads as 90, not 90.00000000000001) and -0. */
export function tidy(v: { x: number; y: number; z: number }): Vec3 {
  const r = (n: number): number => Math.round(n * 1e6) / 1e6 || 0;
  return { x: r(v.x), y: r(v.y), z: r(v.z) };
}

/** spiral yields pixel offsets by growing distance, the centre first, for finding a clickable point on a mesh. */
export function spiral(maxRadius: number, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [[0, 0]];
  for (let r = step; r <= maxRadius; r += step) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      out.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]);
    }
  }
  return out;
}

/** A texture as the browser tests read it: its size and a stable digest of its decoded pixels, rows top first. */
export interface TextureDigest {
  width: number;
  height: number;
  digest: string;
}

/**
 * digestImage hashes a texture's pixels so a round trip can be checked for sameness without comparing PNG
 * bytes (the exporter re-encodes; the pixels are what must not change — REQ-002-5). The image — a canvas, an
 * ImageBitmap or an <img> — is drawn to a scratch canvas and read back in one orientation, so two textures
 * with the same pixels digest the same however each was made.
 */
export function digestImage(image: CanvasImageSource & { width: number; height: number }): TextureDigest | null {
  const width = image.width;
  const height = image.height;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  // FNV-1a over the RGBA bytes: small, stable, and enough to tell one texture from another.
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return { width, height, digest: (hash >>> 0).toString(16).padStart(8, '0') };
}

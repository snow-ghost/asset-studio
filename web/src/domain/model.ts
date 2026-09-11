// What the editor knows about a model without knowing three.js: a transform, a material's parameters,
// and the numbers a designer reads off a model. Pure types and pure checks, so the rules about them run
// under Vitest in Node and the rendering adapter is the only place that touches geometry.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Transform is the root node's TRS: metres, degrees (Euler XYZ), scale factors. */
export interface Transform {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export const IDENTITY: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

/** MaterialParams is the editable part of a glTF metallic-roughness material. Colour is sRGB "#rrggbb". */
export interface MaterialParams {
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  /** The material's name from the file, for the panel; never edited, so a command may leave it out. */
  readonly name?: string;
}

export interface MeshInfo {
  readonly id: string;
  readonly name: string;
  readonly vertices: number;
  readonly indices: number;
  /** The material's id, so two meshes sharing one can be told apart from two equal ones. */
  readonly material: string | null;
}

/** ModelStats is what the panel shows and what the round-trip scenario compares. */
export interface ModelStats {
  readonly meshes: number;
  readonly vertices: number;
  readonly indices: number;
  /** Bounding box of the model as it stands in the scene, in metres. */
  readonly size: Vec3;
  readonly textures: number;
  readonly animations: number;
  readonly meshList: readonly MeshInfo[];
}

function finite(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * validTransform is the rule behind the transform fields: every number finite, every scale factor above
 * zero. A zero scale flattens the model into something the camera cannot frame and the gizmo cannot grab,
 * and a negative one mirrors it, which a designer never means by typing.
 */
export function validTransform(t: Transform): boolean {
  return finite(t.position) && finite(t.rotation) && finite(t.scale) && t.scale.x > 0 && t.scale.y > 0 && t.scale.z > 0;
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** validMaterial keeps metalness and roughness in [0, 1], where glTF defines them, and the colour a full hex. */
export function validMaterial(m: MaterialParams): boolean {
  const unit = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1;
  return HEX_COLOUR.test(m.color) && unit(m.metalness) && unit(m.roughness);
}

/** formatSize prints a bounding box the way the panel shows it: "1.0 × 1.0 × 1.5 m". */
export function formatSize(size: Vec3): string {
  const f = (v: number): string => v.toFixed(1);
  return `${f(size.x)} × ${f(size.y)} × ${f(size.z)} m`;
}

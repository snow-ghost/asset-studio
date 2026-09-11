// The ports are what the application layer needs from the world, stated without naming who provides it.
// three.js, fetch and the DOM live behind them in src/adapters; a test provides fakes. The app layer
// therefore never imports three or touches a browser API, which is what lets the studio's behaviour be
// tested in Node in milliseconds (AGENTS.md, section 4).

import type { Asset, Kind, SaveRequest } from '../domain/asset';
import type { MaterialParams, ModelStats, Transform } from '../domain/model';
import type { Rgba } from '../domain/texture';

/**
 * SceneObject is whatever the rendering adapter puts in the viewport. The app layer only needs a name for
 * status messages; three.js's Object3D satisfies this shape, so no wrapper is needed at the boundary.
 */
export interface SceneObject {
  readonly name: string;
}

/** TextureSource is decoded pixels the adapter can draw or upload — a canvas or an image in the browser. */
export interface TextureSource {
  readonly width: number;
  readonly height: number;
}

/** TextureHandle is a texture living in the scene, opaque to the app: it is only ever put back where it came from. */
export interface TextureHandle {
  readonly uuid: string;
}

/** AssetGateway is studiod as the app sees it. */
export interface AssetGateway {
  list(): Promise<Asset[]>;
  /** save creates (no id) or updates (id set). payload null means a metadata-only update. */
  save(req: SaveRequest, payload: ArrayBuffer | null): Promise<Asset>;
  remove(id: string): Promise<void>;
  payloadUrl(id: string): string;
}

/** ModelCodec turns a scene object into glb bytes and back, from a stored asset or from a file on disk. */
export interface ModelCodec {
  export(obj: SceneObject): Promise<ArrayBuffer>;
  load(url: string): Promise<SceneObject>;
  /** import parses bytes the designer picked; the domain has already checked they are glTF (domain/import). */
  import(bytes: ArrayBuffer, format: 'glb' | 'gltf'): Promise<SceneObject>;
}

/** TextureCodec moves pixels between the forms a texture takes: a recipe's RGBA, a PNG's bytes, a stored asset, a preview. */
export interface TextureCodec {
  /** encode writes a PNG of exactly the source's pixels. */
  encode(source: TextureSource): Promise<ArrayBuffer>;
  fromPixels(rgba: Rgba): TextureSource;
  fromBytes(bytes: ArrayBuffer): Promise<TextureSource>;
  fromUrl(url: string): Promise<TextureSource>;
  /** plane is the preview: the texture on a flat quad, two metres wide, standing on the ground. */
  plane(source: TextureSource): SceneObject;
}

/** Placeholders make the starting geometry for a model kind; a texture placeholder is a recipe (domain/texture). */
export interface Placeholders {
  make(kind: Kind): SceneObject;
}

/** ViewportPort holds one object at a time. */
export interface ViewportPort {
  show(obj: SceneObject | null): void;
  readonly object: SceneObject | null;
}

export type GizmoMode = 'translate' | 'rotate' | 'scale';

/** EditorEvents are the gestures the rendering adapter reports; the session decides what they mean. */
export interface EditorEvents {
  /** A click landed on a mesh (its id from ModelStats.meshList) or on empty space (null). */
  onPick(meshId: string | null): void;
  /** The gizmo is being dragged; the panels may follow live. No command yet. */
  onGizmoMove(): void;
  /** One gizmo drag ended: where the object was before it and where it is now. One command. */
  onGizmoCommit(before: Transform, after: Transform): void;
}

/**
 * EditorPort is the object in the viewport as something to edit: its transform, its materials by id, the
 * numbers a designer reads off it, the selection frame and the gizmo. Commands (app/commands.ts) drive it;
 * the adapter never decides anything, it only does and reports.
 */
export interface EditorPort {
  getTransform(): Transform;
  setTransform(t: Transform): void;
  /** Materials are addressed by id so that two meshes sharing one are edited together, as in the file. */
  getMaterial(materialId: string): MaterialParams | null;
  setMaterial(materialId: string, params: MaterialParams): void;
  /** The base colour texture of a material, as an opaque handle the session can put back on undo. */
  getTexture(materialId: string): TextureHandle | null;
  setTexture(materialId: string, texture: TextureHandle | null): void;
  /** textureFrom makes a scene texture out of pixels, in the orientation glTF expects, so export keeps them as they are. */
  textureFrom(source: TextureSource): TextureHandle;
  stats(): ModelStats | null;
  select(meshId: string | null): void;
  setGizmoMode(mode: GizmoMode): void;
  bind(events: EditorEvents): void;
}

/** ConfirmPort asks the designer a yes/no question before work is thrown away (invariant 10). */
export interface ConfirmPort {
  confirm(question: string): boolean;
}

/** StatusSink is where the designer is told what happened. Every async path ends here, never in the console. */
export interface StatusSink {
  info(message: string): void;
  error(message: string): void;
}

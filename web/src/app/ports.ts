// The ports are what the application layer needs from the world, stated without naming who provides it.
// three.js, fetch and the DOM live behind them in src/adapters; a test provides fakes. The app layer
// therefore never imports three or touches a browser API, which is what lets the studio's behaviour be
// tested in Node in milliseconds (AGENTS.md, section 4).

import type { Asset, Kind, SaveRequest } from '../domain/asset';

/**
 * SceneObject is whatever the rendering adapter puts in the viewport. The app layer only needs a name for
 * status messages; three.js's Object3D satisfies this shape, so no wrapper is needed at the boundary.
 */
export interface SceneObject {
  readonly name: string;
}

/** TextureSource is the pixel source behind a texture asset — a canvas in the browser, anything in a test. */
export interface TextureSource {
  readonly width: number;
  readonly height: number;
}

/** AssetGateway is studiod as the app sees it. */
export interface AssetGateway {
  list(): Promise<Asset[]>;
  /** save creates (no id) or updates (id set). payload null means a metadata-only update. */
  save(req: SaveRequest, payload: ArrayBuffer | null): Promise<Asset>;
  remove(id: string): Promise<void>;
  payloadUrl(id: string): string;
}

/** ModelCodec turns a scene object into glb bytes and back. */
export interface ModelCodec {
  export(obj: SceneObject): Promise<ArrayBuffer>;
  load(url: string): Promise<SceneObject>;
}

/** TextureCodec turns a texture source into png bytes, and a stored png into something to look at. */
export interface TextureCodec {
  encode(source: TextureSource): Promise<ArrayBuffer>;
  load(url: string): Promise<SceneObject>;
}

/** Placeholders make the starting geometry for a kind. */
export interface Placeholders {
  make(kind: Kind): SceneObject;
  textureCanvas(): TextureSource;
}

/** ViewportPort holds one object at a time. */
export interface ViewportPort {
  show(obj: SceneObject | null): void;
  readonly object: SceneObject | null;
}

/** StatusSink is where the designer is told what happened. Every async path ends here, never in the console. */
export interface StatusSink {
  info(message: string): void;
  error(message: string): void;
}

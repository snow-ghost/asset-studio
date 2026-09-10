// Composition root: build the adapters, hand them to the session, bind the UI, start. Nothing here decides
// anything — decisions live in src/app and src/domain, which is what keeps them testable without a browser.
import { StudioSession } from './app/session';
import { HttpAssetGateway, resolveApiBase } from './adapters/http/api';
import { GltfCodec } from './adapters/three/gltf';
import { threePlaceholders } from './adapters/three/placeholders';
import { measure } from './adapters/three/scene-object';
import { PngTextureCodec } from './adapters/three/texture';
import { Viewport } from './adapters/three/viewport';
import { el } from './adapters/ui/dom';
import { bindSidebar } from './adapters/ui/sidebar';
import { StatusLine } from './adapters/ui/status';
import { bindToolbar } from './adapters/ui/toolbar';
import type { StudioDebug } from './studio-debug';

const apiBase = resolveApiBase(import.meta.env);
const viewport = new Viewport(el<HTMLCanvasElement>('canvas'));

const session = new StudioSession({
  gateway: new HttpAssetGateway(apiBase),
  models: new GltfCodec(),
  textures: new PngTextureCodec(),
  placeholders: threePlaceholders,
  viewport,
  status: new StatusLine(el<HTMLSpanElement>('status')),
});

bindToolbar(session, {
  kind: el<HTMLSelectElement>('kind'),
  name: el<HTMLInputElement>('name'),
  wowdRef: el<HTMLInputElement>('wowdRef'),
  newButton: el<HTMLButtonElement>('new'),
  saveButton: el<HTMLButtonElement>('save'),
});
bindSidebar(session, el<HTMLUListElement>('assetList'));

// The debug handle the browser tests read; harmless for a designer, who never sees it.
const debug: StudioDebug = {
  object: () => {
    const obj = viewport.object;
    return obj ? { name: obj.name, kind: session.snapshot().kind, size: measure(obj) } : null;
  },
  state: () => session.snapshot(),
  apiBase,
};
window.__studio = debug;

void session.refreshList();
session.newPlaceholder();

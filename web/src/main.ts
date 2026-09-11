// Composition root: build the adapters, hand them to the session, bind the UI, start. Nothing here decides
// anything — decisions live in src/app and src/domain, which is what keeps them testable without a browser.
import { StudioSession } from './app/session';
import { HttpAssetGateway, resolveApiBase } from './adapters/http/api';
import { ThreeEditor } from './adapters/three/editor';
import { GltfCodec } from './adapters/three/gltf';
import { threePlaceholders } from './adapters/three/placeholders';
import { measure } from './adapters/three/scene-object';
import { CanvasTextureCodec } from './adapters/three/texture';
import { Viewport } from './adapters/three/viewport';
import { browserConfirm } from './adapters/ui/confirm';
import { el } from './adapters/ui/dom';
import { bindInspector } from './adapters/ui/inspector';
import { bindSidebar } from './adapters/ui/sidebar';
import { StatusLine } from './adapters/ui/status';
import { bindToolbar } from './adapters/ui/toolbar';
import type { StudioDebug } from './studio-debug';

const apiBase = resolveApiBase(import.meta.env);
const viewport = new Viewport(el<HTMLCanvasElement>('canvas'));
const editor = new ThreeEditor(viewport);
const status = new StatusLine(el<HTMLSpanElement>('status'));

const session = new StudioSession({
  gateway: new HttpAssetGateway(apiBase),
  models: new GltfCodec(),
  textures: new CanvasTextureCodec(),
  placeholders: threePlaceholders,
  viewport,
  editor,
  confirm: browserConfirm,
  status,
});

bindToolbar(
  session,
  {
    kind: el<HTMLSelectElement>('kind'),
    name: el<HTMLInputElement>('name'),
    wowdRef: el<HTMLInputElement>('wowdRef'),
    newButton: el<HTMLButtonElement>('new'),
    saveButton: el<HTMLButtonElement>('save'),
    importInput: el<HTMLInputElement>('import'),
  },
  status,
);
bindSidebar(session, el<HTMLUListElement>('assetList'));
bindInspector(session, {
  stats: el('stats'),
  size: el('size'),
  position: [el<HTMLInputElement>('pos-x'), el<HTMLInputElement>('pos-y'), el<HTMLInputElement>('pos-z')],
  rotation: [el<HTMLInputElement>('rot-x'), el<HTMLInputElement>('rot-y'), el<HTMLInputElement>('rot-z')],
  scale: [el<HTMLInputElement>('scl-x'), el<HTMLInputElement>('scl-y'), el<HTMLInputElement>('scl-z')],
  modes: {
    translate: el<HTMLButtonElement>('mode-translate'),
    rotate: el<HTMLButtonElement>('mode-rotate'),
    scale: el<HTMLButtonElement>('mode-scale'),
  },
  material: el('material'),
  meshName: el('mesh-name'),
  materialName: el('material-name'),
  color: el<HTMLInputElement>('mat-color'),
  metalness: el<HTMLInputElement>('mat-metalness'),
  roughness: el<HTMLInputElement>('mat-roughness'),
  matTexture: el<HTMLSelectElement>('mat-texture'),
  texture: el('texture'),
  texSize: el('tex-size'),
  texRecipe: el('tex-recipe'),
  texNote: el('tex-note'),
  texType: el<HTMLSelectElement>('tex-type'),
  texRes: el<HTMLSelectElement>('tex-res'),
  texColorA: el<HTMLInputElement>('tex-color-a'),
  texColorB: el<HTMLInputElement>('tex-color-b'),
  texScale: el<HTMLInputElement>('tex-scale'),
  texSeed: el<HTMLInputElement>('tex-seed'),
  texRandomize: el<HTMLButtonElement>('tex-randomize'),
  undo: el<HTMLButtonElement>('undo'),
  redo: el<HTMLButtonElement>('redo'),
  dirty: el('dirty'),
});

// The debug handle the browser tests read; harmless for a designer, who never sees it. Everything is read
// from the real scene and the real session — nothing here can move the model.
const debug: StudioDebug = {
  object: () => {
    const obj = viewport.object;
    return obj ? { name: obj.name, kind: session.snapshot().kind, size: measure(obj) } : null;
  },
  state: () => session.snapshot(),
  apiBase,
  stats: () => editor.stats(),
  transform: () => (viewport.object ? editor.getTransform() : null),
  material: (meshName) => editor.materialOf(meshName),
  selectedMeshName: () => editor.meshName(session.snapshot().selectedMesh),
  gizmoMode: () => session.snapshot().gizmoMode,
  framed: () => viewport.framed(),
  screenPositionOf: (meshName) => editor.screenPositionOf(meshName),
  gizmoHandleScreenPosition: (axis) => editor.gizmoHandleScreenPosition(axis),
  emptySpaceScreenPosition: () => editor.emptySpaceScreenPosition(),
  texture: () => editor.textureDigest(),
  procedural: () => session.snapshot().procedural,
  materialTexture: (meshName) => editor.materialTextureDigest(meshName),
};
window.__studio = debug;

void session.refreshList();
session.newPlaceholder();

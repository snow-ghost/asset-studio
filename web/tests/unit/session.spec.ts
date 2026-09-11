// @req-000-11 @req-000-12 @req-001-1 @req-001-2 @req-001-3 @req-001-4 @req-001-5 @req-001-7 @req-002-1 @req-002-2 @req-002-3 @req-002-4 @req-002-7
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { StudioSession, type SessionPorts, type SessionState } from '../../src/app/session';
import type { EditorEvents, EditorPort, GizmoMode, SceneObject, TextureHandle, TextureSource } from '../../src/app/ports';
import { DEFAULT_TEXTURE_PARAMS, type Rgba } from '../../src/domain/texture';
import type { Asset, Kind, SaveRequest } from '../../src/domain/asset';
import { IDENTITY, type MaterialParams, type ModelStats, type Transform } from '../../src/domain/model';

const FIXTURES = new URL('../../../testdata/', import.meta.url);
function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(name, FIXTURES));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * FakeEditor is a model the session can edit without three.js: a transform, two meshes sharing nothing and
 * two sharing one material, and a record of what was asked. It reports the gestures a real adapter would
 * through the events the session bound.
 */
class FakeEditor implements EditorPort {
  transform: Transform = IDENTITY;
  materials = new Map<string, MaterialParams>([
    ['m-hide', { color: '#8b5a2b', metalness: 0, roughness: 0.9 }],
    ['m-bone', { color: '#e8e2d0', metalness: 0.1, roughness: 0.6 }],
  ]);
  selected: Array<string | null> = [];
  modes: GizmoMode[] = [];
  events: EditorEvents | null = null;
  present = true;

  getTransform(): Transform {
    return this.transform;
  }
  setTransform(t: Transform): void {
    this.transform = t;
  }
  getMaterial(id: string): MaterialParams | null {
    return this.materials.get(id) ?? null;
  }
  setMaterial(id: string, m: MaterialParams): void {
    if (this.materials.has(id)) this.materials.set(id, m);
  }
  stats(): ModelStats | null {
    if (!this.present) return null;
    return {
      meshes: 3,
      vertices: 48,
      indices: 60,
      size: { x: 1, y: 1, z: 1.5 },
      textures: 1,
      animations: 1,
      meshList: [
        { id: 'body', name: 'body', vertices: 24, indices: 36, material: 'm-hide' },
        { id: 'tl', name: 'tusk_left', vertices: 12, indices: 12, material: 'm-bone' },
        { id: 'tr', name: 'tusk_right', vertices: 12, indices: 12, material: 'm-bone' },
        { id: 'plane', name: 'unlit', vertices: 4, indices: 6, material: null },
      ],
    };
  }
  maps = new Map<string, TextureHandle | null>([
    ['m-hide', { uuid: 'embedded-hide' }],
    ['m-bone', null],
  ]);
  getTexture(id: string): TextureHandle | null {
    return this.maps.get(id) ?? null;
  }
  setTexture(id: string, t: TextureHandle | null): void {
    this.maps.set(id, t);
  }
  textureFrom(source: TextureSource): TextureHandle {
    return { uuid: `tex:${(source as FakeSource).label}` };
  }
  select(id: string | null): void {
    this.selected.push(id);
  }
  setGizmoMode(mode: GizmoMode): void {
    this.modes.push(mode);
  }
  bind(events: EditorEvents): void {
    this.events = events;
  }
}

/** FakeSource is a TextureSource that remembers where its pixels came from, so a test can tell them apart. */
interface FakeSource extends TextureSource {
  readonly label: string;
}

// The fakes record what the session asked of the world. They are deliberately dumb: the session is the
// thing under test, and a clever fake would be a second implementation to keep right.
function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}
function decode(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    name: 'moss_boar',
    kind: 'creature',
    format: 'glb',
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    ...over,
  };
}

function world() {
  const status = {
    infos: [] as string[],
    errors: [] as string[],
    info(m: string) {
      this.infos.push(m);
    },
    error(m: string) {
      this.errors.push(m);
    },
  };
  const viewport = {
    object: null as SceneObject | null,
    shown: [] as Array<SceneObject | null>,
    show(o: SceneObject | null) {
      this.object = o;
      this.shown.push(o);
    },
  };
  const placeholders = {
    made: [] as Kind[],
    make(kind: Kind): SceneObject {
      this.made.push(kind);
      return { name: `placeholder_${kind}` };
    },
  };
  const models = {
    imported: [] as string[],
    export: (obj: SceneObject) => Promise.resolve(bytes(`glb:${obj.name}`)),
    load: (url: string) => Promise.resolve({ name: `model:${url}` }),
    import(_bytes: ArrayBuffer, format: string) {
      this.imported.push(format);
      return Promise.resolve({ name: `imported:${format}` });
    },
  };
  const editor = new FakeEditor();
  const confirm = {
    answer: true,
    asked: [] as string[],
    confirm(q: string) {
      this.asked.push(q);
      return this.answer;
    },
  };
  const textures = {
    encoded: [] as string[],
    encode(src: TextureSource) {
      this.encoded.push((src as FakeSource).label);
      return Promise.resolve(bytes(`png:${src.width}`));
    },
    fromPixels: (rgba: Rgba): FakeSource => ({ width: rgba.width, height: rgba.height, label: `pixels:${rgba.width}:${rgba.data[0]}` }),
    fromBytes: (b: ArrayBuffer): Promise<FakeSource> => Promise.resolve({ width: 64, height: 64, label: `bytes:${b.byteLength}` }),
    fromUrl: (url: string): Promise<FakeSource> => Promise.resolve({ width: 64, height: 64, label: `url:${url}` }),
    plane: (src: TextureSource): SceneObject => ({ name: `plane:${(src as FakeSource).label}` }),
  };
  const gateway = {
    assets: [] as Asset[],
    saves: [] as Array<{ req: SaveRequest; payload: string }>,
    removed: [] as string[],
    failWith: null as string | null,
    list() {
      if (this.failWith) return Promise.reject(new Error(this.failWith));
      return Promise.resolve([...this.assets]);
    },
    save(req: SaveRequest, payload: ArrayBuffer | null) {
      if (this.failWith) return Promise.reject(new Error(this.failWith));
      this.saves.push({ req, payload: payload ? decode(payload) : '' });
      const saved = asset({ id: req.id ?? 'new-id', name: req.name, kind: req.kind, format: req.format });
      this.assets = [saved, ...this.assets.filter((a) => a.id !== saved.id)];
      return Promise.resolve(saved);
    },
    remove(id: string) {
      if (this.failWith) return Promise.reject(new Error(this.failWith));
      this.removed.push(id);
      this.assets = this.assets.filter((a) => a.id !== id);
      return Promise.resolve();
    },
    payloadUrl: (id: string) => `/api/assets/${id}/payload`,
  };
  const ports: SessionPorts = { gateway, models, textures, placeholders, viewport, editor, confirm, status };
  const session = new StudioSession(ports);
  const states: SessionState[] = [];
  session.subscribe((s) => states.push(s));
  return { session, status, viewport, placeholders, gateway, models, textures, editor, confirm, states };
}

describe('newPlaceholder', () => {
  it('shows a placeholder of the chosen kind, forgets the active asset and names it once', () => {
    const w = world();
    w.session.setKind('item');
    w.session.newPlaceholder();
    expect(w.viewport.object).toEqual({ name: 'placeholder_item' });
    expect(w.session.snapshot()).toMatchObject({ activeId: null, kind: 'item', name: 'item_new' });
    expect(w.status.infos.at(-1)).toBe('new item placeholder — edit and Save');

    // A name the designer typed survives the next placeholder.
    w.session.setName('rusty_blade');
    w.session.newPlaceholder();
    expect(w.session.snapshot().name).toBe('rusty_blade');
  });

  it('makes a texture placeholder from the default recipe and a model one from geometry', () => {
    const w = world();
    w.session.setKind('texture');
    w.session.newPlaceholder();
    expect(w.viewport.object?.name).toBe('plane:pixels:256:107'); // #6b4f2a → red channel 0x6b = 107
    expect(w.session.snapshot()).toMatchObject({ procedural: DEFAULT_TEXTURE_PARAMS, textureSize: { width: 256, height: 256 } });
    expect(w.placeholders.made).toEqual([]);
    w.session.setKind('creature');
    w.session.newPlaceholder();
    expect(w.placeholders.made).toEqual(['creature']);
    expect(w.session.snapshot()).toMatchObject({ procedural: null, textureSize: null });
  });
});

describe('save', () => {
  it('refuses without a name and never calls the gateway', async () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setName('   ');
    await w.session.save();
    expect(w.status.errors).toEqual(['give it a name first']);
    expect(w.gateway.saves).toEqual([]);
  });

  it('refuses when the viewport is empty', async () => {
    const w = world();
    w.session.setName('moss_boar');
    await w.session.save();
    expect(w.status.errors).toEqual(['nothing to save — make a placeholder first']);
    expect(w.gateway.saves).toEqual([]);
  });

  it.each<[Kind, string, string, object | undefined]>([
    ['creature', 'glb', 'glb:placeholder_creature', undefined],
    ['texture', 'png', 'png:256', DEFAULT_TEXTURE_PARAMS],
  ])('a %s is sent as %s with the bytes its codec produced', async (kind, format, payload, procedural) => {
    const w = world();
    w.session.setKind(kind);
    w.session.newPlaceholder();
    w.session.setName('thing');
    w.session.setWowdRef('  moss_boar ');
    await w.session.save();
    expect(w.gateway.saves).toEqual([
      { req: { id: undefined, name: 'thing', kind, format, wowdRef: 'moss_boar', procedural }, payload },
    ]);
  });

  it('makes the saved asset active, reports it and refreshes the list', async () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setName('hero_body');
    await w.session.save();
    expect(w.session.snapshot().activeId).toBe('new-id');
    expect(w.status.infos.at(-1)).toBe('saved hero_body');
    expect(w.states.at(-1)?.assets.map((a) => a.name)).toEqual(['hero_body']);

    // Saving again updates in place: the id goes with the request.
    await w.session.save();
    expect(w.gateway.saves[1]?.req.id).toBe('new-id');
  });

  it('puts a gateway failure on the status line instead of throwing', async () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setName('hero_body');
    w.gateway.failWith = 'boom';
    await expect(w.session.save()).resolves.toBeUndefined();
    expect(w.status.errors).toEqual(['save failed: boom']);
    expect(w.session.snapshot().activeId).toBeNull();
  });
});

describe('load', () => {
  it('fills the form from the asset and shows its payload', async () => {
    const w = world();
    await w.session.load(asset({ id: 'a7', name: 'Mossy Boar', kind: 'creature', wowdRef: 'moss_boar' }));
    expect(w.session.snapshot()).toMatchObject({ activeId: 'a7', kind: 'creature', name: 'Mossy Boar', wowdRef: 'moss_boar' });
    expect(w.viewport.object).toEqual({ name: 'model:/api/assets/a7/payload' });
    expect(w.status.infos.at(-1)).toBe('loaded Mossy Boar');
  });

  it('shows a png through the texture codec and clears a missing wowdRef', async () => {
    const w = world();
    w.session.setWowdRef('stale');
    await w.session.load(asset({ id: 't1', name: 'bark', kind: 'texture', format: 'png' }));
    expect(w.viewport.object).toEqual({ name: 'plane:url:/api/assets/t1/payload' });
    expect(w.session.snapshot()).toMatchObject({ wowdRef: '', textureSize: { width: 64, height: 64 }, procedural: null });
  });

  it('reports a codec failure on the status line', async () => {
    const w = world();
    const s = new StudioSession({
      gateway: w.gateway,
      models: {
        export: () => Promise.reject(new Error('no')),
        load: () => Promise.reject(new Error('bad glb')),
        import: () => Promise.reject(new Error('no')),
      },
      textures: {
        encode: () => Promise.reject(new Error('no')),
        fromPixels: w.textures.fromPixels,
        fromBytes: () => Promise.reject(new Error('no')),
        fromUrl: () => Promise.reject(new Error('no')),
        plane: w.textures.plane,
      },
      placeholders: w.placeholders,
      viewport: w.viewport,
      editor: w.editor,
      confirm: w.confirm,
      status: w.status,
    });
    await s.load(asset());
    expect(w.status.errors).toEqual(['load failed: bad glb']);
  });
});

describe('remove', () => {
  it('clears the viewport when the active asset is deleted and refreshes the list', async () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setName('moss_boar');
    await w.session.save();
    await w.session.remove('new-id');
    expect(w.gateway.removed).toEqual(['new-id']);
    expect(w.viewport.object).toBeNull();
    expect(w.session.snapshot().activeId).toBeNull();
    expect(w.states.at(-1)?.assets).toEqual([]);
    expect(w.status.infos.at(-1)).toBe('deleted');
  });

  it('leaves the viewport alone when another asset is deleted', async () => {
    const w = world();
    w.gateway.assets = [asset({ id: 'other' })];
    w.session.newPlaceholder();
    await w.session.remove('other');
    expect(w.viewport.object).toEqual({ name: 'placeholder_character' });
  });

  it('reports a failure on the status line', async () => {
    const w = world();
    w.gateway.failWith = 'nope';
    await w.session.remove('x');
    expect(w.status.errors).toEqual(['delete failed: nope']);
  });
});

describe('refreshList', () => {
  it('shows an unreachable API as a list error rather than an exception', async () => {
    const w = world();
    w.gateway.failWith = 'ECONNREFUSED';
    await expect(w.session.refreshList()).resolves.toBeUndefined();
    expect(w.states.at(-1)).toMatchObject({ assets: [], listError: 'ECONNREFUSED' });
    w.gateway.failWith = null;
    w.gateway.assets = [asset()];
    await w.session.refreshList();
    expect(w.states.at(-1)).toMatchObject({ listError: null });
    expect(w.states.at(-1)?.assets).toHaveLength(1);
  });
});

// --- M1: the editor ---

const moved: Transform = { ...IDENTITY, position: { x: 1, y: 0, z: -2 } };

describe('importFile', () => {
  it('shows the model, names the asset after the file and marks it modified', async () => {
    const w = world();
    w.session.setKind('creature');
    w.session.newPlaceholder(); // the studio opens on a placeholder with a made-up name
    await w.session.importFile({ name: 'models/moss_boar.glb', bytes: fixture('moss_boar.glb') });
    expect(w.models.imported).toEqual(['glb']);
    expect(w.viewport.object).toEqual({ name: 'imported:glb' });
    expect(w.session.snapshot()).toMatchObject({ activeId: null, name: 'moss_boar', dirty: true, kind: 'creature' });
    expect(w.status.infos.at(-1)).toBe('imported models/moss_boar.glb: 3 meshes, 48 vertices, 1.0 × 1.0 × 1.5 m');
  });

  it('keeps a name the designer typed', async () => {
    const w = world();
    w.session.setKind('creature');
    w.session.setName('boar_v2');
    await w.session.importFile({ name: 'moss_boar.gltf', bytes: fixture('moss_boar.gltf') });
    expect(w.models.imported).toEqual(['gltf']);
    expect(w.session.snapshot().name).toBe('boar_v2');
  });

  it.each<[string, Kind, string]>([
    ['not-a-model.bin', 'creature', 'not a glTF'],
    ['external.gltf', 'creature', 'external files'],
    ['draco.gltf', 'creature', 'compression'],
    ['moss_boar.glb', 'texture', 'PNG'],
    ['not-a-model.bin', 'texture', 'not a glTF or PNG'],
  ])('refuses %s as a %s and leaves the viewport alone', async (file, kind, reason) => {
    const w = world();
    w.session.setKind('creature');
    w.session.newPlaceholder();
    w.session.setKind(kind);
    await w.session.importFile({ name: file, bytes: fixture(file) });
    expect(w.models.imported).toEqual([]);
    expect(w.status.errors.at(-1)).toContain(reason);
    expect(w.viewport.object).toEqual({ name: 'placeholder_creature' });
    expect(w.session.snapshot().dirty).toBe(false);
  });

  it('puts a parser failure on the status line', async () => {
    const w = world();
    w.session.setKind('creature');
    w.models.import = () => Promise.reject(new Error('bad chunk'));
    await w.session.importFile({ name: 'moss_boar.glb', bytes: fixture('moss_boar.glb') });
    expect(w.status.errors.at(-1)).toBe('import failed: bad chunk');
  });
});

describe('transform and material edits', () => {
  it('applies a valid transform as one undoable command and marks the asset modified', () => {
    const w = world();
    w.session.newPlaceholder();
    expect(w.session.setTransform(moved)).toBe(true);
    expect(w.editor.transform).toEqual(moved);
    expect(w.session.snapshot()).toMatchObject({ dirty: true, canUndo: true, canRedo: false, transform: moved });
  });

  it.each<Transform>([
    { ...IDENTITY, scale: { x: 0, y: 1, z: 1 } },
    { ...IDENTITY, scale: { x: -2, y: 1, z: 1 } },
    { ...IDENTITY, position: { x: Number.NaN, y: 0, z: 0 } },
    { ...IDENTITY, rotation: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } },
  ])('refuses an unusable transform %o and changes nothing', (bad) => {
    const w = world();
    w.session.newPlaceholder();
    expect(w.session.setTransform(bad)).toBe(false);
    expect(w.editor.transform).toEqual(IDENTITY);
    expect(w.status.errors.at(-1)).toBe('a transform needs finite numbers and a scale above zero');
    expect(w.session.snapshot()).toMatchObject({ dirty: false, canUndo: false });
  });

  it('edits the selected mesh material through its id, so a shared material follows', () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.select('tl');
    expect(w.editor.selected.at(-1)).toBe('tl');
    expect(w.session.snapshot().material).toEqual({ color: '#e8e2d0', metalness: 0.1, roughness: 0.6 });
    const green = { color: '#00ff00', metalness: 0.5, roughness: 0.2 };
    expect(w.session.setMaterial(green)).toBe(true);
    expect(w.editor.getMaterial('m-bone')).toEqual(green);
    expect(w.editor.getMaterial('m-hide')).toEqual({ color: '#8b5a2b', metalness: 0, roughness: 0.9 });
  });

  it('refuses a material edit without a selection or on an unlit mesh', () => {
    const w = world();
    w.session.newPlaceholder();
    expect(w.session.setMaterial({ color: '#ff0000', metalness: 0, roughness: 1 })).toBe(false);
    w.session.select('plane');
    expect(w.session.snapshot().material).toBeNull();
    expect(w.session.setMaterial({ color: '#ff0000', metalness: 0, roughness: 1 })).toBe(false);
    expect(w.status.errors.at(-1)).toBe('select a mesh with an editable material first');
  });

  it('refuses out-of-range material values', () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.select('body');
    expect(w.session.setMaterial({ color: 'red', metalness: 0, roughness: 1 })).toBe(false);
    expect(w.session.setMaterial({ color: '#ff0000', metalness: 1.5, roughness: 1 })).toBe(false);
    expect(w.editor.getMaterial('m-hide')?.color).toBe('#8b5a2b');
  });

  it('clearing the selection hides the material', () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.select('body');
    w.session.select(null);
    expect(w.editor.selected).toEqual([null, 'body', null]);
    expect(w.session.snapshot()).toMatchObject({ selectedMesh: null, material: null });
  });
});

describe('history', () => {
  it('undoes and redoes a move, and a new edit forgets the redo', () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setTransform(moved);
    w.session.undo();
    expect(w.editor.transform).toEqual(IDENTITY);
    expect(w.session.snapshot()).toMatchObject({ canUndo: false, canRedo: true });
    w.session.redo();
    expect(w.editor.transform).toEqual(moved);
    w.session.undo();
    const up = { ...IDENTITY, position: { x: 0, y: 2, z: 0 } };
    w.session.setTransform(up);
    expect(w.session.snapshot()).toMatchObject({ canRedo: false, transform: up });
  });

  it('keeps fifty steps and no more', () => {
    const w = world();
    w.session.newPlaceholder();
    for (let i = 1; i <= 60; i++) w.session.setTransform({ ...IDENTITY, position: { x: i / 10, y: 0, z: 0 } });
    for (let i = 0; i < 50; i++) w.session.undo();
    expect(w.editor.transform.position.x).toBeCloseTo(1.0, 6);
    expect(w.session.snapshot().canUndo).toBe(false);
  });

  it('records one gizmo drag as one step and ignores a drag that moved nothing', () => {
    const w = world();
    w.session.newPlaceholder();
    w.editor.transform = moved; // the adapter already moved the object during the drag
    w.editor.events?.onGizmoCommit(IDENTITY, moved);
    expect(w.session.snapshot()).toMatchObject({ canUndo: true, dirty: true });
    w.editor.events?.onGizmoCommit(moved, moved);
    w.session.undo();
    expect(w.editor.transform).toEqual(IDENTITY);
    expect(w.session.snapshot().canUndo).toBe(false);
  });

  it('survives a save: saving clears the modified mark but not the history', async () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setName('moss_boar');
    w.session.setTransform(moved);
    await w.session.save();
    expect(w.session.snapshot()).toMatchObject({ dirty: false, canUndo: true });
    w.session.undo();
    expect(w.editor.transform).toEqual(IDENTITY);
    expect(w.session.snapshot().dirty).toBe(true);
  });

  it('follows the gizmo mode and reports live moves without a command', () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.setGizmoMode('rotate');
    expect(w.editor.modes).toEqual(['rotate']);
    expect(w.session.snapshot().gizmoMode).toBe('rotate');
    const before = w.states.length;
    w.editor.events?.onGizmoMove();
    expect(w.states.length).toBe(before + 1);
    expect(w.session.snapshot().canUndo).toBe(false);
  });
});

describe('unsaved changes', () => {
  async function dirtyWorld() {
    const w = world();
    w.gateway.assets = [asset({ id: 'other', name: 'other' })];
    w.session.setKind('creature');
    await w.session.importFile({ name: 'moss_boar.glb', bytes: fixture('moss_boar.glb') });
    expect(w.session.snapshot().dirty).toBe(true);
    return w;
  }

  it('asks before a new placeholder, an import and a load, and no means stay', async () => {
    const w = await dirtyWorld();
    w.confirm.answer = false;
    w.session.newPlaceholder();
    await w.session.importFile({ name: 'moss_boar.gltf', bytes: fixture('moss_boar.gltf') });
    await w.session.load(asset({ id: 'other', name: 'other' }));
    expect(w.confirm.asked).toHaveLength(3);
    expect(w.viewport.object).toEqual({ name: 'imported:glb' });
    expect(w.session.snapshot()).toMatchObject({ dirty: true, activeId: null });
  });

  it('yes discards the work and clears the mark', async () => {
    const w = await dirtyWorld();
    w.confirm.answer = true;
    w.session.newPlaceholder();
    expect(w.viewport.object).toEqual({ name: 'placeholder_creature' });
    expect(w.session.snapshot()).toMatchObject({ dirty: false, canUndo: false });
  });

  it('does not ask when nothing is unsaved', () => {
    const w = world();
    w.session.newPlaceholder();
    w.session.newPlaceholder();
    expect(w.confirm.asked).toEqual([]);
  });
});

// --- M2: textures ---

describe('textures', () => {
  it('imports a PNG as a texture asset and saves its bytes as they came', async () => {
    const w = world();
    w.session.setKind('texture');
    w.session.newPlaceholder();
    await w.session.importFile({ name: 'skins/bark_diffuse.png', bytes: fixture('bark_diffuse.png') });
    expect(w.viewport.object?.name).toMatch(/^plane:bytes:/);
    expect(w.session.snapshot()).toMatchObject({ name: 'bark_diffuse', dirty: true, procedural: null, textureSize: { width: 64, height: 64 } });
    expect(w.status.infos.at(-1)).toBe('imported skins/bark_diffuse.png: 64 × 64 px');
    await w.session.save();
    expect(w.gateway.saves).toHaveLength(1);
    expect(w.gateway.saves[0]?.payload).toBe(decode(fixture('bark_diffuse.png')));
    expect(w.gateway.saves[0]?.req).toMatchObject({ kind: 'texture', format: 'png', procedural: undefined });
    expect(w.textures.encoded).toEqual([]);
  });

  it('refuses a PNG under a model kind and a glTF under the texture kind', async () => {
    const w = world();
    w.session.setKind('creature');
    w.session.newPlaceholder();
    await w.session.importFile({ name: 'bark_diffuse.png', bytes: fixture('bark_diffuse.png') });
    expect(w.status.errors.at(-1)).toContain('imported as glTF');
    w.session.setKind('texture');
    await w.session.importFile({ name: 'moss_boar.glb', bytes: fixture('moss_boar.glb') });
    expect(w.status.errors.at(-1)).toContain('PNG');
    expect(w.viewport.object).toEqual({ name: 'placeholder_creature' });
  });

  it('re-renders the recipe on a parameter change and saves the rendered pixels with the recipe', async () => {
    const w = world();
    w.session.setKind('texture');
    w.session.newPlaceholder();
    w.session.setName('moss_noise');
    expect(w.session.setTextureParams({ type: 'noise', seed: 42, size: 512 })).toBe(true);
    expect(w.session.snapshot()).toMatchObject({ dirty: true, procedural: { ...DEFAULT_TEXTURE_PARAMS, type: 'noise', seed: 42, size: 512 }, textureSize: { width: 512, height: 512 } });
    await w.session.save();
    expect(w.textures.encoded).toHaveLength(1);
    expect(w.gateway.saves[0]?.req.procedural).toEqual({ ...DEFAULT_TEXTURE_PARAMS, type: 'noise', seed: 42, size: 512 });
    expect(w.gateway.saves[0]?.payload).toBe('png:512');
  });

  it.each<Partial<Parameters<StudioSession['setTextureParams']>[0]>>([
    { scale: 0 },
    { scale: 1.5 },
    { seed: -1 },
    { colorA: 'brown' },
  ])('refuses an unusable recipe %o and keeps the old one', (bad) => {
    const w = world();
    w.session.setKind('texture');
    w.session.newPlaceholder();
    expect(w.session.setTextureParams(bad)).toBe(false);
    expect(w.session.snapshot().procedural).toEqual(DEFAULT_TEXTURE_PARAMS);
    expect(w.status.errors.at(-1)).toContain('recipe');
  });

  it('has no parameters for an imported picture', async () => {
    const w = world();
    w.session.setKind('texture');
    await w.session.importFile({ name: 'bark_diffuse.png', bytes: fixture('bark_diffuse.png') });
    expect(w.session.setTextureParams({ seed: 3 })).toBe(false);
    expect(w.status.errors.at(-1)).toContain('not a recipe');
  });

  it('opens a procedural texture with its recipe and re-saves an untouched one without a payload', async () => {
    const w = world();
    const recipe = { ...DEFAULT_TEXTURE_PARAMS, type: 'stripes' as const, seed: 5 };
    await w.session.load(asset({ id: 't1', name: 'stripes', kind: 'texture', format: 'png', procedural: recipe }));
    expect(w.session.snapshot()).toMatchObject({ procedural: recipe, dirty: false, textureSize: { width: 64, height: 64 } });
    await w.session.save();
    expect(w.gateway.saves[0]).toMatchObject({ payload: '' });
    expect(w.gateway.saves[0]?.req).toMatchObject({ id: 't1', procedural: recipe });
    // A parameter change re-renders and the next save carries pixels again.
    w.session.setTextureParams({ seed: 99 });
    await w.session.save();
    expect(w.gateway.saves[1]?.payload).toBe('png:256');
    expect(w.gateway.saves[1]?.req.procedural).toMatchObject({ seed: 99 });
  });

  it('ignores a recipe it cannot read and treats the texture as a picture', async () => {
    const w = world();
    await w.session.load(asset({ id: 't2', name: 'odd', kind: 'texture', format: 'png', procedural: { type: 'plaid' } as never }));
    expect(w.session.snapshot().procedural).toBeNull();
  });

  it('puts a texture asset on the selected material as one undoable command', async () => {
    const w = world();
    w.gateway.assets = [asset({ id: 'bark', name: 'bark', kind: 'texture', format: 'png' }), asset({ id: 'm1', name: 'model' })];
    await w.session.refreshList();
    w.session.setKind('creature');
    w.session.newPlaceholder();
    w.session.select('tl');
    expect(w.session.snapshot().materialTexture).toEqual({ present: false, assetId: null });
    expect(await w.session.assignTexture('bark')).toBe(true);
    expect(w.editor.getTexture('m-bone')).toEqual({ uuid: 'tex:url:/api/assets/bark/payload' });
    expect(w.session.snapshot()).toMatchObject({ dirty: true, canUndo: true, materialTexture: { present: true, assetId: 'bark' } });
    expect(w.status.infos.at(-1)).toBe('texture bark on tusk_left');
    w.session.undo();
    expect(w.editor.getTexture('m-bone')).toBeNull();
    w.session.redo();
    expect(await w.session.assignTexture(null)).toBe(true);
    expect(w.editor.getTexture('m-bone')).toBeNull();
    expect(w.session.snapshot().materialTexture).toEqual({ present: false, assetId: null });
  });

  it('shows a texture that came with the model as embedded', () => {
    const w = world();
    w.session.setKind('creature');
    w.session.newPlaceholder();
    w.session.select('body');
    expect(w.session.snapshot().materialTexture).toEqual({ present: true, assetId: null });
  });

  it('refuses to assign without a selection or with something that is not a texture asset', async () => {
    const w = world();
    w.gateway.assets = [asset({ id: 'm1', name: 'model' })];
    await w.session.refreshList();
    w.session.setKind('creature');
    w.session.newPlaceholder();
    expect(await w.session.assignTexture('m1')).toBe(false);
    w.session.select('body');
    expect(await w.session.assignTexture('m1')).toBe(false);
    expect(w.status.errors.at(-1)).toContain('texture assets');
    expect(await w.session.assignTexture('missing')).toBe(false);
  });
});

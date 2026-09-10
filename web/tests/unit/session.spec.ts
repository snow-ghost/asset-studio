// @req-000-11 @req-000-12
import { describe, expect, it } from 'vitest';
import { StudioSession, type SessionPorts, type SessionState } from '../../src/app/session';
import type { SceneObject, TextureSource } from '../../src/app/ports';
import type { Asset, Kind, SaveRequest } from '../../src/domain/asset';

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
    canvases: 0,
    make(kind: Kind): SceneObject {
      this.made.push(kind);
      return { name: `placeholder_${kind}` };
    },
    textureCanvas(): TextureSource {
      this.canvases++;
      return { width: 256, height: 256 };
    },
  };
  const models = {
    export: (obj: SceneObject) => Promise.resolve(bytes(`glb:${obj.name}`)),
    load: (url: string) => Promise.resolve({ name: `model:${url}` }),
  };
  const textures = {
    encode: (src: TextureSource) => Promise.resolve(bytes(`png:${src.width}`)),
    load: (url: string) => Promise.resolve({ name: `plane:${url}` }),
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
  const ports: SessionPorts = { gateway, models, textures, placeholders, viewport, status };
  const session = new StudioSession(ports);
  const states: SessionState[] = [];
  session.subscribe((s) => states.push(s));
  return { session, status, viewport, placeholders, gateway, states };
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

  it('keeps a canvas for a texture and none for a model', () => {
    const w = world();
    w.session.setKind('texture');
    w.session.newPlaceholder();
    expect(w.placeholders.canvases).toBe(1);
    w.session.setKind('creature');
    w.session.newPlaceholder();
    expect(w.placeholders.canvases).toBe(1);
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

  it.each<[Kind, string, string]>([
    ['creature', 'glb', 'glb:placeholder_creature'],
    ['texture', 'png', 'png:256'],
  ])('a %s is sent as %s with the bytes its codec produced', async (kind, format, payload) => {
    const w = world();
    w.session.setKind(kind);
    w.session.newPlaceholder();
    w.session.setName('thing');
    w.session.setWowdRef('  moss_boar ');
    await w.session.save();
    expect(w.gateway.saves).toEqual([
      { req: { id: undefined, name: 'thing', kind, format, wowdRef: 'moss_boar' }, payload },
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
    expect(w.viewport.object).toEqual({ name: 'plane:/api/assets/t1/payload' });
    expect(w.session.snapshot().wowdRef).toBe('');
  });

  it('reports a codec failure on the status line', async () => {
    const w = world();
    const s = new StudioSession({
      gateway: w.gateway,
      models: { export: () => Promise.reject(new Error('no')), load: () => Promise.reject(new Error('bad glb')) },
      textures: { encode: () => Promise.reject(new Error('no')), load: () => Promise.reject(new Error('no')) },
      placeholders: w.placeholders,
      viewport: w.viewport,
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

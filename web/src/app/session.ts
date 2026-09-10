// StudioSession is the studio's behaviour with the browser taken out: which asset is active, what the
// form fields hold, what the list shows, and the four things a designer does — new placeholder, save,
// load, delete. main.ts wires it to real adapters; tests/unit/session.spec.ts wires it to fakes.

import { defaultName, formatFor, validateName, type Asset, type Kind } from '../domain/asset';
import type {
  AssetGateway,
  ModelCodec,
  Placeholders,
  StatusSink,
  TextureCodec,
  TextureSource,
  ViewportPort,
} from './ports';

export interface SessionPorts {
  gateway: AssetGateway;
  models: ModelCodec;
  textures: TextureCodec;
  placeholders: Placeholders;
  viewport: ViewportPort;
  status: StatusSink;
}

export interface SessionState {
  readonly activeId: string | null;
  readonly kind: Kind;
  readonly name: string;
  readonly wowdRef: string;
  readonly assets: readonly Asset[];
  /** Set when the last list refresh failed; the sidebar shows it instead of an empty list. */
  readonly listError: string | null;
}

export type Listener = (state: SessionState) => void;

export class StudioSession {
  private activeId: string | null = null;
  private kind: Kind = 'character';
  private name = '';
  private wowdRef = '';
  private assets: Asset[] = [];
  private listError: string | null = null;
  // The source behind a texture placeholder, kept so Save can emit its PNG.
  private pendingTexture: TextureSource | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly ports: SessionPorts) {}

  /** subscribe calls fn now and after every change; it returns the unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): SessionState {
    return {
      activeId: this.activeId,
      kind: this.kind,
      name: this.name,
      wowdRef: this.wowdRef,
      assets: this.assets,
      listError: this.listError,
    };
  }

  // The form fields are owned by the UI; it tells the session what they hold, so a save reads the session
  // and never the DOM. These do not notify: no other view depends on a half-typed name.
  setKind(kind: Kind): void {
    this.kind = kind;
  }
  setName(name: string): void {
    this.name = name;
  }
  setWowdRef(ref: string): void {
    this.wowdRef = ref;
  }

  newPlaceholder(): void {
    this.activeId = null;
    this.pendingTexture = this.kind === 'texture' ? this.ports.placeholders.textureCanvas() : null;
    this.ports.viewport.show(this.ports.placeholders.make(this.kind));
    if (!this.name) this.name = defaultName(this.kind);
    this.ports.status.info(`new ${this.kind} placeholder — edit and Save`);
    this.emit();
  }

  async save(): Promise<void> {
    const check = validateName(this.name);
    if (!check.ok) {
      this.ports.status.error(check.reason);
      return;
    }
    const obj = this.ports.viewport.object;
    if (!obj) {
      this.ports.status.error('nothing to save — make a placeholder first');
      return;
    }
    try {
      this.ports.status.info('saving…');
      const format = formatFor(this.kind);
      // A texture is saved from the canvas behind its placeholder; a loaded texture has none, so it is
      // re-rendered procedurally — the M0 behaviour, which M2 (texture editing) replaces.
      const bytes =
        format === 'png'
          ? await this.ports.textures.encode(this.pendingTexture ?? this.ports.placeholders.textureCanvas())
          : await this.ports.models.export(obj);
      const saved = await this.ports.gateway.save(
        {
          id: this.activeId ?? undefined,
          name: check.name,
          kind: this.kind,
          format,
          wowdRef: this.wowdRef.trim() || undefined,
        },
        bytes,
      );
      this.activeId = saved.id;
      this.ports.status.info(`saved ${saved.name}`);
      await this.refreshList();
    } catch (err) {
      this.ports.status.error(`save failed: ${message(err)}`);
    }
  }

  async load(asset: Asset): Promise<void> {
    try {
      this.ports.status.info(`loading ${asset.name}…`);
      this.activeId = asset.id;
      this.kind = asset.kind;
      this.name = asset.name;
      this.wowdRef = asset.wowdRef ?? '';
      this.pendingTexture = null;
      const url = this.ports.gateway.payloadUrl(asset.id);
      const obj = asset.format === 'png' ? await this.ports.textures.load(url) : await this.ports.models.load(url);
      this.ports.viewport.show(obj);
      this.ports.status.info(`loaded ${asset.name}`);
    } catch (err) {
      this.ports.status.error(`load failed: ${message(err)}`);
    }
    this.emit();
  }

  async remove(id: string): Promise<void> {
    try {
      await this.ports.gateway.remove(id);
      if (this.activeId === id) {
        this.activeId = null;
        this.ports.viewport.show(null);
      }
      await this.refreshList();
      this.ports.status.info('deleted');
    } catch (err) {
      this.ports.status.error(`delete failed: ${message(err)}`);
    }
  }

  /** refreshList never throws: an unreachable API is something the sidebar shows, not an exception. */
  async refreshList(): Promise<void> {
    try {
      this.assets = await this.ports.gateway.list();
      this.listError = null;
    } catch (err) {
      this.assets = [];
      this.listError = message(err);
    }
    this.emit();
  }

  private emit(): void {
    const state = this.snapshot();
    for (const fn of this.listeners) fn(state);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// StudioSession is the studio's behaviour with the browser taken out: which asset is active, what the
// form fields hold, what the list shows, what is selected and what can be undone — and the things a
// designer does: new placeholder, import, edit, save, load, delete. main.ts wires it to real adapters;
// tests/unit/session.spec.ts wires it to fakes.

import { defaultName, formatFor, isDefaultName, validateName, type Asset, type Kind } from '../domain/asset';
import { inspectModelFile, nameFromFile } from '../domain/import';
import {
  formatSize,
  validMaterial,
  validTransform,
  type MaterialParams,
  type ModelStats,
  type Transform,
} from '../domain/model';
import { History, SetMaterial, SetTransform } from './commands';
import type {
  AssetGateway,
  ConfirmPort,
  EditorPort,
  GizmoMode,
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
  editor: EditorPort;
  confirm: ConfirmPort;
  status: StatusSink;
}

/** ImportedFile is what the file input hands over: the name for the default asset name, the bytes to check. */
export interface ImportedFile {
  readonly name: string;
  readonly bytes: ArrayBuffer;
}

export interface SessionState {
  readonly activeId: string | null;
  readonly kind: Kind;
  readonly name: string;
  readonly wowdRef: string;
  readonly assets: readonly Asset[];
  /** Set when the last list refresh failed; the sidebar shows it instead of an empty list. */
  readonly listError: string | null;
  /** True when what is in the viewport differs from what is stored (invariant 10). */
  readonly dirty: boolean;
  readonly selectedMesh: string | null;
  /** The selected mesh's material, or null when nothing is selected or the material is not editable. */
  readonly material: MaterialParams | null;
  readonly transform: Transform | null;
  readonly stats: ModelStats | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly gizmoMode: GizmoMode;
}

export type Listener = (state: SessionState) => void;

export class StudioSession {
  private activeId: string | null = null;
  private kind: Kind = 'character';
  private name = '';
  private wowdRef = '';
  private assets: Asset[] = [];
  private listError: string | null = null;
  private dirty = false;
  private selectedMesh: string | null = null;
  private gizmoMode: GizmoMode = 'translate';
  private readonly history = new History();
  // The source behind a texture placeholder, kept so Save can emit its PNG.
  private pendingTexture: TextureSource | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly ports: SessionPorts) {
    ports.editor.bind({
      onPick: (meshId) => this.select(meshId),
      onGizmoMove: () => this.emit(),
      onGizmoCommit: (before, after) => this.commitGizmo(before, after),
    });
  }

  /** subscribe calls fn now and after every change; it returns the unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): SessionState {
    const hasObject = this.ports.viewport.object !== null;
    return {
      activeId: this.activeId,
      kind: this.kind,
      name: this.name,
      wowdRef: this.wowdRef,
      assets: this.assets,
      listError: this.listError,
      dirty: this.dirty,
      selectedMesh: this.selectedMesh,
      material: this.selectedMaterialParams(),
      transform: hasObject ? this.ports.editor.getTransform() : null,
      stats: hasObject ? this.ports.editor.stats() : null,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      gizmoMode: this.gizmoMode,
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
    if (!this.leaveUnsaved('Discard unsaved changes and start a new placeholder?')) return;
    this.activeId = null;
    this.pendingTexture = this.kind === 'texture' ? this.ports.placeholders.textureCanvas() : null;
    this.replaceObject(this.ports.placeholders.make(this.kind));
    if (!this.name) this.name = defaultName(this.kind);
    this.ports.status.info(`new ${this.kind} placeholder — edit and Save`);
    this.emit();
  }

  /** importModel takes a file the designer picked. The domain decides whether it is usable; three.js parses it. */
  async importModel(file: ImportedFile): Promise<void> {
    if (!this.leaveUnsaved(`Discard unsaved changes and import ${file.name}?`)) return;
    const verdict = inspectModelFile(file.bytes, this.kind);
    if (!verdict.ok) {
      this.ports.status.error(`import refused: ${verdict.reason}`);
      return;
    }
    try {
      this.ports.status.info(`importing ${file.name}…`);
      const obj = await this.ports.models.import(file.bytes, verdict.format);
      this.activeId = null;
      this.pendingTexture = null;
      this.replaceObject(obj);
      // A name the designer typed is theirs; one the studio made up gives way to the file's.
      if (!this.name || isDefaultName(this.name)) this.name = nameFromFile(file.name);
      this.dirty = true;
      this.ports.status.info(`imported ${file.name}: ${describe(this.ports.editor.stats())}`);
    } catch (err) {
      this.ports.status.error(`import failed: ${message(err)}`);
    }
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
      // Saved is not the same as forgotten: the history stays, so a save can still be undone (REQ-001-4).
      this.dirty = false;
      this.ports.status.info(`saved ${saved.name}`);
      await this.refreshList();
    } catch (err) {
      this.ports.status.error(`save failed: ${message(err)}`);
    }
  }

  async load(asset: Asset): Promise<void> {
    if (!this.leaveUnsaved(`Discard unsaved changes and open ${asset.name}?`)) return;
    try {
      this.ports.status.info(`loading ${asset.name}…`);
      this.activeId = asset.id;
      this.kind = asset.kind;
      this.name = asset.name;
      this.wowdRef = asset.wowdRef ?? '';
      this.pendingTexture = null;
      const url = this.ports.gateway.payloadUrl(asset.id);
      const obj = asset.format === 'png' ? await this.ports.textures.load(url) : await this.ports.models.load(url);
      this.replaceObject(obj);
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
        this.replaceObject(null);
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

  // --- editing ---

  /** setTransform is the numeric panel's path: one command per accepted edit. Returns whether it was accepted. */
  setTransform(after: Transform): boolean {
    if (!this.ports.viewport.object) return false;
    if (!validTransform(after)) {
      this.ports.status.error('a transform needs finite numbers and a scale above zero');
      this.emit();
      return false;
    }
    this.history.push(new SetTransform(this.ports.editor, this.ports.editor.getTransform(), after));
    this.touch();
    return true;
  }

  select(meshId: string | null): void {
    this.selectedMesh = meshId;
    this.ports.editor.select(meshId);
    this.emit();
  }

  /** setMaterial edits the selected mesh's material; meshes sharing it follow. Returns whether it was accepted. */
  setMaterial(after: MaterialParams): boolean {
    const materialId = this.selectedMaterialId();
    const before = materialId ? this.ports.editor.getMaterial(materialId) : null;
    if (!materialId || !before) {
      this.ports.status.error('select a mesh with an editable material first');
      return false;
    }
    if (!validMaterial(after)) {
      this.ports.status.error('a material needs a #rrggbb colour and metalness and roughness between 0 and 1');
      this.emit();
      return false;
    }
    this.history.push(new SetMaterial(this.ports.editor, materialId, before, after));
    this.touch();
    return true;
  }

  undo(): void {
    if (this.history.undo()) this.touch();
  }

  redo(): void {
    if (this.history.redo()) this.touch();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.ports.editor.setGizmoMode(mode);
    this.emit();
  }

  // --- internals ---

  /** commitGizmo records a finished drag as one command; the object is already where the drag left it. */
  private commitGizmo(before: Transform, after: Transform): void {
    if (sameTransform(before, after)) return;
    this.history.push(new SetTransform(this.ports.editor, before, after));
    this.touch();
  }

  /** replaceObject swaps what the viewport shows and forgets everything that belonged to the old object. */
  private replaceObject(obj: Parameters<ViewportPort['show']>[0]): void {
    this.selectedMesh = null;
    this.ports.editor.select(null);
    this.history.clear();
    this.dirty = false;
    this.ports.viewport.show(obj);
  }

  /** leaveUnsaved is the one question the studio asks: only when there is something to lose. */
  private leaveUnsaved(question: string): boolean {
    return !this.dirty || this.ports.confirm.confirm(question);
  }

  private touch(): void {
    this.dirty = true;
    this.emit();
  }

  private selectedMaterialId(): string | null {
    if (!this.selectedMesh) return null;
    const mesh = this.ports.editor.stats()?.meshList.find((m) => m.id === this.selectedMesh);
    return mesh?.material ?? null;
  }

  private selectedMaterialParams(): MaterialParams | null {
    const id = this.selectedMaterialId();
    return id ? this.ports.editor.getMaterial(id) : null;
  }

  private emit(): void {
    const state = this.snapshot();
    for (const fn of this.listeners) fn(state);
  }
}

function describe(stats: ModelStats | null): string {
  if (!stats) return 'no geometry';
  return `${stats.meshes} meshes, ${stats.vertices} vertices, ${formatSize(stats.size)}`;
}

function sameTransform(a: Transform, b: Transform): boolean {
  const same = (p: keyof Transform): boolean => a[p].x === b[p].x && a[p].y === b[p].y && a[p].z === b[p].z;
  return same('position') && same('rotation') && same('scale');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

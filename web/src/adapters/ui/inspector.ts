import { formatSize, type Transform, type Vec3 } from '../../domain/model';
import { TEXTURE_SIZES, TEXTURE_TYPES, type TextureType } from '../../domain/texture';
import type { GizmoMode } from '../../app/ports';
import type { SessionState, StudioSession } from '../../app/session';

// The inspector is the right-hand panel: what the model measures, where it stands, what the selected mesh
// is made of and wears, and the texture in the viewport. It renders from session state and turns edits
// into session calls; every rule about what an edit may be lives in the session and the domain, so a
// refused edit simply re-renders the field from state.

export interface InspectorElements {
  stats: HTMLElement;
  size: HTMLElement;
  position: [HTMLInputElement, HTMLInputElement, HTMLInputElement];
  rotation: [HTMLInputElement, HTMLInputElement, HTMLInputElement];
  scale: [HTMLInputElement, HTMLInputElement, HTMLInputElement];
  modes: Record<GizmoMode, HTMLButtonElement>;
  material: HTMLElement;
  meshName: HTMLElement;
  materialName: HTMLElement;
  color: HTMLInputElement;
  metalness: HTMLInputElement;
  roughness: HTMLInputElement;
  matTexture: HTMLSelectElement;
  texture: HTMLElement;
  texSize: HTMLElement;
  texRecipe: HTMLElement;
  texNote: HTMLElement;
  texType: HTMLSelectElement;
  texRes: HTMLSelectElement;
  texColorA: HTMLInputElement;
  texColorB: HTMLInputElement;
  texScale: HTMLInputElement;
  texSeed: HTMLInputElement;
  texRandomize: HTMLButtonElement;
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  dirty: HTMLElement;
}

const MODE_KEYS: Record<string, GizmoMode> = { w: 'translate', e: 'rotate', r: 'scale' };
const EMBEDDED = '__embedded';

export function bindInspector(session: StudioSession, els: InspectorElements): void {
  fillOptions(els.texType, TEXTURE_TYPES);
  fillOptions(els.texRes, TEXTURE_SIZES.map(String));

  const fields = [...els.position, ...els.rotation, ...els.scale];
  const revert = (): void => render(session.snapshot(), true);

  for (const field of fields) {
    field.addEventListener('change', () => {
      if (!session.setTransform(readTransform(els))) revert();
    });
  }
  for (const [mode, button] of Object.entries(els.modes) as Array<[GizmoMode, HTMLButtonElement]>) {
    button.addEventListener('click', () => session.setGizmoMode(mode));
  }
  for (const input of [els.color, els.metalness, els.roughness]) {
    input.addEventListener('change', () => {
      const accepted = session.setMaterial({ color: els.color.value, metalness: Number(els.metalness.value), roughness: Number(els.roughness.value) });
      if (!accepted) revert();
    });
  }
  els.matTexture.addEventListener('change', () => {
    const value = els.matTexture.value;
    if (value === EMBEDDED) return; // the texture the model came with; not a choice
    void session.assignTexture(value || null);
  });

  const recipe = (): void => {
    const accepted = session.setTextureParams({
      type: els.texType.value as TextureType,
      size: Number(els.texRes.value) as (typeof TEXTURE_SIZES)[number],
      colorA: els.texColorA.value,
      colorB: els.texColorB.value,
      scale: Math.round(Number(els.texScale.value)),
      seed: Math.round(Number(els.texSeed.value)),
    });
    if (!accepted) revert();
  };
  for (const control of [els.texType, els.texRes, els.texColorA, els.texColorB, els.texScale, els.texSeed]) {
    control.addEventListener('change', recipe);
  }
  // The one place randomness may live is the UI (invariant 4): the seed is a number the designer could type.
  els.texRandomize.addEventListener('click', () => session.setTextureParams({ seed: Math.floor(Math.random() * 0xffffffff) }));

  els.undo.addEventListener('click', () => session.undo());
  els.redo.addEventListener('click', () => session.redo());

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) session.redo();
      else session.undo();
    } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
      e.preventDefault();
      session.redo();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && MODE_KEYS[key]) {
      session.setGizmoMode(MODE_KEYS[key]);
    }
  });

  function render(state: SessionState, force: boolean): void {
    const s = state.stats;
    els.stats.textContent = s
      ? `${count(s.meshes, 'mesh', 'meshes')} · ${count(s.vertices, 'vertex', 'vertices')} · ${count(s.indices, 'index', 'indices')} · ${count(s.textures, 'texture', 'textures')} · ${count(s.animations, 'animation', 'animations')}`
      : 'no model';
    els.size.textContent = s ? formatSize(s.size) : '';

    renderVec(els.position, state.transform?.position, force);
    renderVec(els.rotation, state.transform?.rotation, force);
    renderVec(els.scale, state.transform?.scale, force);
    for (const field of fields) field.disabled = state.transform === null;

    for (const [mode, button] of Object.entries(els.modes) as Array<[GizmoMode, HTMLButtonElement]>) {
      button.classList.toggle('active', mode === state.gizmoMode);
    }

    renderMaterial(state, force);
    renderTexture(state, force);

    els.undo.disabled = !state.canUndo;
    els.redo.disabled = !state.canRedo;
    els.dirty.hidden = !state.dirty;
    document.title = state.dirty ? '● Asset Studio' : 'Asset Studio';
  }

  function renderMaterial(state: SessionState, force: boolean): void {
    els.material.hidden = state.material === null;
    if (!state.material) return;
    els.meshName.textContent = state.stats?.meshList.find((m) => m.id === state.selectedMesh)?.name ?? '';
    els.materialName.textContent = state.material.name ?? '';
    setValue(els.color, state.material.color, force);
    setValue(els.metalness, numberText(state.material.metalness), force);
    setValue(els.roughness, numberText(state.material.roughness), force);
    renderTextureChoices(state);
  }

  function renderTextureChoices(state: SessionState): void {
    const textures = state.assets.filter((a) => a.kind === 'texture');
    const tex = state.materialTexture;
    const selected = tex?.present ? (tex.assetId ?? EMBEDDED) : '';
    els.matTexture.replaceChildren();
    els.matTexture.append(option('none', ''));
    if (tex?.present && tex.assetId === null) {
      const embedded = option('embedded', EMBEDDED);
      embedded.disabled = true;
      els.matTexture.append(embedded);
    }
    for (const t of textures) els.matTexture.append(option(t.name, t.id));
    els.matTexture.value = selected;
  }

  function renderTexture(state: SessionState, force: boolean): void {
    els.texture.hidden = state.textureSize === null;
    if (!state.textureSize) return;
    els.texSize.textContent = `${state.textureSize.width} × ${state.textureSize.height} px`;
    const p = state.procedural;
    els.texRecipe.hidden = p === null;
    els.texNote.hidden = p !== null;
    if (!p) return;
    setSelect(els.texType, p.type, force);
    setSelect(els.texRes, String(p.size), force);
    setValue(els.texColorA, p.colorA, force);
    setValue(els.texColorB, p.colorB, force);
    setValue(els.texScale, String(p.scale), force);
    setValue(els.texSeed, String(p.seed), force);
  }

  session.subscribe((state) => render(state, false));
}

function readTransform(els: InspectorElements): Transform {
  const vec = (f: [HTMLInputElement, HTMLInputElement, HTMLInputElement]): Vec3 => ({ x: Number(f[0].value), y: Number(f[1].value), z: Number(f[2].value) });
  return { position: vec(els.position), rotation: vec(els.rotation), scale: vec(els.scale) };
}

function fillOptions(select: HTMLSelectElement, values: readonly string[]): void {
  select.replaceChildren(...values.map((v) => option(v, v)));
}

function option(label: string, value: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  return o;
}

function renderVec(fields: [HTMLInputElement, HTMLInputElement, HTMLInputElement], v: Vec3 | undefined, force: boolean): void {
  const values = v ? [v.x, v.y, v.z] : ['', '', ''];
  fields.forEach((field, i) => setValue(field, typeof values[i] === 'number' ? numberText(values[i]) : '', force));
}

function setValue(input: HTMLInputElement, text: string, force: boolean): void {
  if (!force && document.activeElement === input) return;
  if (input.value !== text) input.value = text;
}

function setSelect(select: HTMLSelectElement, value: string, force: boolean): void {
  if (!force && document.activeElement === select) return;
  if (select.value !== value) select.value = value;
}

function numberText(n: number): string {
  return String(Number(n.toFixed(4)));
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

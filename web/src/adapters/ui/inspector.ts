import { formatSize, type Transform, type Vec3 } from '../../domain/model';
import type { GizmoMode } from '../../app/ports';
import type { SessionState, StudioSession } from '../../app/session';

// The inspector is the right-hand panel: what the model measures, where it stands, what the selected mesh
// is made of, and the history buttons. It renders from session state and turns edits into session calls;
// every rule about what an edit may be lives in the session and the domain, so a refused edit simply
// re-renders the field from state.

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
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
  dirty: HTMLElement;
}

const MODE_KEYS: Record<string, GizmoMode> = { w: 'translate', e: 'rotate', r: 'scale' };

export function bindInspector(session: StudioSession, els: InspectorElements): void {
  const fields = [...els.position, ...els.rotation, ...els.scale];

  // A refused edit puts the field back to what the model actually has — even the field being typed in.
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
      const accepted = session.setMaterial({
        color: els.color.value,
        metalness: Number(els.metalness.value),
        roughness: Number(els.roughness.value),
      });
      if (!accepted) revert();
    });
  }
  els.undo.addEventListener('click', () => session.undo());
  els.redo.addEventListener('click', () => session.redo());

  document.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return; // a field's own text editing wins over the studio's shortcuts
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

    els.material.hidden = state.material === null;
    if (state.material) {
      els.meshName.textContent = state.stats?.meshList.find((m) => m.id === state.selectedMesh)?.name ?? '';
      els.materialName.textContent = state.material.name ?? '';
      setValue(els.color, state.material.color, force);
      setValue(els.metalness, numberText(state.material.metalness), force);
      setValue(els.roughness, numberText(state.material.roughness), force);
    }

    els.undo.disabled = !state.canUndo;
    els.redo.disabled = !state.canRedo;

    els.dirty.hidden = !state.dirty;
    document.title = state.dirty ? '● Asset Studio' : 'Asset Studio';
  }

  session.subscribe((state) => render(state, false));
}

function readTransform(els: InspectorElements): Transform {
  const vec = (f: [HTMLInputElement, HTMLInputElement, HTMLInputElement]): Vec3 => ({
    x: Number(f[0].value),
    y: Number(f[1].value),
    z: Number(f[2].value),
  });
  return { position: vec(els.position), rotation: vec(els.rotation), scale: vec(els.scale) };
}

function renderVec(fields: [HTMLInputElement, HTMLInputElement, HTMLInputElement], v: Vec3 | undefined, force: boolean): void {
  const values = v ? [v.x, v.y, v.z] : ['', '', ''];
  fields.forEach((field, i) => setValue(field, typeof values[i] === 'number' ? numberText(values[i]) : '', force));
}

/** setValue writes a field unless the designer is typing in it; force overrides that for a revert. */
function setValue(input: HTMLInputElement, text: string, force: boolean): void {
  if (!force && document.activeElement === input) return;
  if (input.value !== text) input.value = text;
}

/** numberText prints a value the way a designer types it: no exponent, no trailing float noise. */
function numberText(n: number): string {
  return String(Number(n.toFixed(4)));
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

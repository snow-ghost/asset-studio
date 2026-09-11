import { isKind } from '../../domain/asset';
import type { StatusSink } from '../../app/ports';
import type { StudioSession } from '../../app/session';

export interface ToolbarElements {
  kind: HTMLSelectElement;
  name: HTMLInputElement;
  wowdRef: HTMLInputElement;
  newButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  importInput: HTMLInputElement;
}

// The toolbar owns the form fields and keeps the session told about them; when the session changes them
// itself (loading an asset, naming a fresh placeholder) it writes them back. Writes only happen when the
// value differs, so a session change never fights the designer's typing.
export function bindToolbar(session: StudioSession, els: ToolbarElements, status: StatusSink): void {
  const kindFromSelect = (): void => {
    // The select is the source of truth for a new placeholder or an import: a loaded asset may have set
    // another kind.
    if (isKind(els.kind.value)) session.setKind(els.kind.value);
  };
  els.kind.addEventListener('change', kindFromSelect);
  els.name.addEventListener('input', () => session.setName(els.name.value));
  els.wowdRef.addEventListener('input', () => session.setWowdRef(els.wowdRef.value));
  els.newButton.addEventListener('click', () => {
    kindFromSelect();
    session.newPlaceholder();
  });
  els.saveButton.addEventListener('click', () => void session.save());
  els.importInput.addEventListener('change', () => {
    const file = els.importInput.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        kindFromSelect();
        await session.importFile({ name: file.name, bytes });
      } catch (err) {
        status.error(`import failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        // Cleared so that picking the same file again fires change again — a designer re-imports after
        // fixing the file in their editor.
        els.importInput.value = '';
      }
    })();
  });

  session.subscribe((state) => {
    if (els.kind.value !== state.kind) els.kind.value = state.kind;
    if (els.name.value !== state.name) els.name.value = state.name;
    if (els.wowdRef.value !== state.wowdRef) els.wowdRef.value = state.wowdRef;
  });
}

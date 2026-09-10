import { isKind } from '../../domain/asset';
import type { StudioSession } from '../../app/session';

export interface ToolbarElements {
  kind: HTMLSelectElement;
  name: HTMLInputElement;
  wowdRef: HTMLInputElement;
  newButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
}

// The toolbar owns the form fields and keeps the session told about them; when the session changes them
// itself (loading an asset, naming a fresh placeholder) it writes them back. Writes only happen when the
// value differs, so a session change never fights the designer's typing.
export function bindToolbar(session: StudioSession, els: ToolbarElements): void {
  els.kind.addEventListener('change', () => {
    if (isKind(els.kind.value)) session.setKind(els.kind.value);
  });
  els.name.addEventListener('input', () => session.setName(els.name.value));
  els.wowdRef.addEventListener('input', () => session.setWowdRef(els.wowdRef.value));
  els.newButton.addEventListener('click', () => {
    // The select is the source of truth for a new placeholder: a loaded asset may have set another kind.
    if (isKind(els.kind.value)) session.setKind(els.kind.value);
    session.newPlaceholder();
  });
  els.saveButton.addEventListener('click', () => void session.save());

  session.subscribe((state) => {
    if (els.kind.value !== state.kind) els.kind.value = state.kind;
    if (els.name.value !== state.name) els.name.value = state.name;
    if (els.wowdRef.value !== state.wowdRef) els.wowdRef.value = state.wowdRef;
  });
}

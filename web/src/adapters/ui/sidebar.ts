import type { Asset } from '../../domain/asset';
import type { StudioSession } from '../../app/session';

// The sidebar renders the session's asset list and turns clicks into load and delete. Everything the
// designer typed goes through textContent, never innerHTML: an asset called "<b>" must show as "<b>".
// confirm() lives here and nowhere else — the app layer must not know a browser dialog exists.
export function bindSidebar(session: StudioSession, list: HTMLUListElement): void {
  session.subscribe((state) => {
    list.replaceChildren();
    if (state.listError) {
      list.append(emptyRow(`API unreachable: ${state.listError}`));
      return;
    }
    if (state.assets.length === 0) {
      list.append(emptyRow('No assets yet. Make one and Save.'));
      return;
    }
    for (const asset of state.assets) list.append(row(session, asset, asset.id === state.activeId));
  });
}

function emptyRow(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

function row(session: StudioSession, asset: Asset, active: boolean): HTMLLIElement {
  const li = document.createElement('li');
  if (active) li.classList.add('active');

  const label = document.createElement('div');
  label.style.cursor = 'pointer';
  const name = document.createElement('div');
  name.textContent = asset.name;
  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.textContent = asset.kind;
  label.append(name, kind);
  if (asset.wowdRef) {
    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = ` → ${asset.wowdRef}`;
    label.append(' ', ref);
  }
  label.addEventListener('click', () => void session.load(asset));

  const del = document.createElement('button');
  del.textContent = '✕';
  del.title = 'delete';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (confirm(`Delete ${asset.name}?`)) void session.remove(asset.id);
  });

  li.append(label, del);
  return li;
}

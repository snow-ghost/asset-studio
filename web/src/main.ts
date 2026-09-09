import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { api, toBase64, type Asset, type Kind } from './api';
import { Viewport } from './viewport';
import { makePlaceholder, makeTextureCanvas } from './placeholders';

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
};

const canvas = el<HTMLCanvasElement>('canvas');
const kindSel = el<HTMLSelectElement>('kind');
const nameInput = el<HTMLInputElement>('name');
const refInput = el<HTMLInputElement>('wowdRef');
const statusEl = el<HTMLSpanElement>('status');
const listEl = el<HTMLUListElement>('assetList');

const viewport = new Viewport(canvas);
let activeId: string | null = null;
// The canvas behind a texture placeholder, kept so Save can emit its PNG.
let pendingTexture: HTMLCanvasElement | null = null;

function setStatus(msg: string, error = false): void {
  statusEl.textContent = msg;
  statusEl.style.color = error ? '#e5766f' : '#8b98a9';
}

function newPlaceholder(): void {
  const kind = kindSel.value as Kind;
  activeId = null;
  pendingTexture = kind === 'texture' ? makeTextureCanvas() : null;
  viewport.show(makePlaceholder(kind));
  if (!nameInput.value) nameInput.value = `${kind}_new`;
  highlight(null);
  setStatus(`new ${kind} placeholder — edit and Save`);
}

async function save(): Promise<void> {
  const kind = kindSel.value as Kind;
  const name = nameInput.value.trim();
  if (!name) {
    setStatus('give it a name first', true);
    return;
  }
  const obj = viewport.object;
  if (!obj) {
    setStatus('nothing to save — make a placeholder first', true);
    return;
  }
  try {
    setStatus('saving…');
    let format: string;
    let data: string;
    if (kind === 'texture') {
      const canvasSource = pendingTexture ?? makeTextureCanvas();
      data = toBase64(await canvasToPng(canvasSource));
      format = 'png';
    } else {
      data = toBase64(await exportGlb(obj));
      format = 'glb';
    }
    const saved = await api.save({
      id: activeId ?? undefined,
      name,
      kind,
      format,
      wowdRef: refInput.value.trim() || undefined,
      data,
    });
    activeId = saved.id;
    setStatus(`saved ${saved.name}`);
    await refreshList();
  } catch (err) {
    setStatus(`save failed: ${(err as Error).message}`, true);
  }
}

async function load(asset: Asset): Promise<void> {
  try {
    setStatus(`loading ${asset.name}…`);
    activeId = asset.id;
    kindSel.value = asset.kind;
    nameInput.value = asset.name;
    refInput.value = asset.wowdRef ?? '';
    pendingTexture = null;
    const url = api.payloadUrl(asset.id);
    if (asset.format === 'png') {
      viewport.show(await texturePlane(url));
    } else {
      const gltf = await new GLTFLoader().loadAsync(url);
      viewport.show(gltf.scene);
    }
    highlight(asset.id);
    setStatus(`loaded ${asset.name}`);
  } catch (err) {
    setStatus(`load failed: ${(err as Error).message}`, true);
  }
}

async function remove(id: string): Promise<void> {
  try {
    await api.remove(id);
    if (activeId === id) {
      activeId = null;
      viewport.show(null);
    }
    await refreshList();
    setStatus('deleted');
  } catch (err) {
    setStatus(`delete failed: ${(err as Error).message}`, true);
  }
}

async function refreshList(): Promise<void> {
  let assets: Asset[];
  try {
    assets = await api.list();
  } catch (err) {
    listEl.innerHTML = `<li class="empty">API unreachable: ${(err as Error).message}</li>`;
    return;
  }
  listEl.innerHTML = '';
  if (assets.length === 0) {
    listEl.innerHTML = '<li class="empty">No assets yet. Make one and Save.</li>';
    return;
  }
  for (const a of assets) {
    const li = document.createElement('li');
    if (a.id === activeId) li.classList.add('active');
    const label = document.createElement('div');
    label.innerHTML = `<div>${escapeHtml(a.name)}</div>` +
      `<span class="kind">${a.kind}</span>` +
      (a.wowdRef ? ` <span class="ref">→ ${escapeHtml(a.wowdRef)}</span>` : '');
    label.style.cursor = 'pointer';
    label.addEventListener('click', () => void load(a));
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'delete';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete ${a.name}?`)) void remove(a.id);
    });
    li.append(label, del);
    listEl.append(li);
  }
}

function highlight(id: string | null): void {
  for (const li of Array.from(listEl.children)) li.classList.remove('active');
  if (!id) return;
  void refreshList();
}

function exportGlb(obj: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      obj,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('expected a binary glb'));
      },
      (err) => reject(new Error(String(err))),
      { binary: true },
    );
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('canvas has no image'));
      blob.arrayBuffer().then(resolve).catch(reject);
    }, 'image/png');
  });
}

async function texturePlane(url: string): Promise<THREE.Object3D> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.y = 1;
  return mesh;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

el<HTMLButtonElement>('new').addEventListener('click', newPlaceholder);
el<HTMLButtonElement>('save').addEventListener('click', () => void save());

void refreshList();
newPlaceholder();

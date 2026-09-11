import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { EditorEvents, EditorPort, GizmoMode, TextureHandle, TextureSource } from '../../app/ports';
import { IDENTITY, type MaterialParams, type MeshInfo, type ModelStats, type Transform } from '../../domain/model';
import type { Viewport } from './viewport';
import { asArray, digestImage, editable, firstOf, localSize, spiral, texturesOf, tidy, type Editable, type TextureDigest } from './model-stats';
import { textureFrom } from './texture';

// The object in the viewport as something to edit. The editor does and reports; it decides nothing —
// what a click means, whether a transform is acceptable, what goes into the history is the session's
// business (src/app). Materials are addressed by id so that two meshes sharing one, as glTF allows, are
// edited together exactly as the file the game loads will have them.
const HIGHLIGHT = 0xffc857;
// A click is a press and release that did not travel; anything farther is an orbit drag.
const CLICK_SLOP_PX = 4;

export class ThreeEditor implements EditorPort {
  private readonly controls: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private events: EditorEvents | null = null;
  private frame: THREE.BoxHelper | null = null;
  private dragStart: Transform | null = null;
  private press: { x: number; y: number; onGizmo: boolean } | null = null;

  constructor(private readonly viewport: Viewport) {
    this.controls = new TransformControls(viewport.camera, viewport.canvas);
    this.controls.size = 0.9;
    viewport.scene.add(this.controls.getHelper());

    this.controls.addEventListener('dragging-changed', (e) => {
      viewport.controls.enabled = e.value !== true;
    });
    this.controls.addEventListener('mouseDown', () => {
      this.dragStart = this.getTransform();
    });
    this.controls.addEventListener('objectChange', () => this.events?.onGizmoMove());
    this.controls.addEventListener('mouseUp', () => {
      if (this.dragStart) this.events?.onGizmoCommit(this.dragStart, this.getTransform());
      this.dragStart = null;
    });

    viewport.onObjectChanged((obj) => {
      this.select(null);
      if (obj) this.controls.attach(obj);
      else this.controls.detach();
    });
    this.viewport.onFrame(() => this.frame?.update());

    viewport.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    viewport.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  bind(events: EditorEvents): void {
    this.events = events;
  }

  // --- transform ---

  getTransform(): Transform {
    const o = this.viewport.object;
    if (!o) return IDENTITY;
    return {
      position: tidy(o.position),
      rotation: tidy({ x: THREE.MathUtils.radToDeg(o.rotation.x), y: THREE.MathUtils.radToDeg(o.rotation.y), z: THREE.MathUtils.radToDeg(o.rotation.z) }),
      scale: tidy(o.scale),
    };
  }

  setTransform(t: Transform): void {
    const o = this.viewport.object;
    if (!o) return;
    o.position.set(t.position.x, t.position.y, t.position.z);
    o.rotation.set(THREE.MathUtils.degToRad(t.rotation.x), THREE.MathUtils.degToRad(t.rotation.y), THREE.MathUtils.degToRad(t.rotation.z), 'XYZ');
    o.scale.set(t.scale.x, t.scale.y, t.scale.z);
    o.updateMatrixWorld(true);
  }

  // --- materials and textures ---

  getMaterial(materialId: string): MaterialParams | null {
    const m = this.materials().get(materialId);
    return m ? { color: `#${m.color.getHexString()}`, metalness: m.metalness, roughness: m.roughness, name: m.name } : null;
  }

  setMaterial(materialId: string, params: MaterialParams): void {
    const m = this.materials().get(materialId);
    if (!m) return;
    m.color.set(params.color);
    m.metalness = params.metalness;
    m.roughness = params.roughness;
  }

  getTexture(materialId: string): TextureHandle | null {
    return this.materials().get(materialId)?.map ?? null;
  }

  setTexture(materialId: string, texture: TextureHandle | null): void {
    const m = this.materials().get(materialId);
    if (!m) return;
    // The handle is a scene texture the session got from this editor; nothing else can produce one.
    m.map = texture instanceof THREE.Texture ? texture : null;
    m.needsUpdate = true;
  }

  textureFrom(source: TextureSource): TextureHandle {
    return textureFrom(source);
  }

  // --- reading the model ---

  stats(): ModelStats | null {
    const root = this.viewport.object;
    if (!root) return null;
    const meshList: MeshInfo[] = [];
    const textures = new Set<THREE.Texture>();
    let vertices = 0;
    let indices = 0;
    for (const mesh of this.meshes()) {
      const v = mesh.geometry.getAttribute('position')?.count ?? 0;
      const i = mesh.geometry.index?.count ?? 0;
      vertices += v;
      indices += i;
      const material = editable(firstOf(mesh.material));
      meshList.push({ id: mesh.uuid, name: mesh.name, vertices: v, indices: i, material: material?.uuid ?? null });
      for (const m of asArray(mesh.material)) for (const t of texturesOf(m)) textures.add(t);
    }
    return { meshes: meshList.length, vertices, indices, size: localSize(root, this.meshes()), textures: textures.size, animations: root.animations.length, meshList };
  }

  select(meshId: string | null): void {
    if (this.frame) {
      this.viewport.scene.remove(this.frame);
      this.frame.dispose();
      this.frame = null;
    }
    const mesh = meshId ? this.meshes().find((m) => m.uuid === meshId) : undefined;
    if (!mesh) return;
    // A frame around the mesh rather than a change to its material: the highlight must neither alter what
    // the designer is judging nor ever end up in the exported file.
    this.frame = new THREE.BoxHelper(mesh, HIGHLIGHT);
    this.viewport.scene.add(this.frame);
  }

  setGizmoMode(mode: GizmoMode): void {
    this.controls.setMode(mode);
  }

  // --- what the browser tests read (src/studio-debug.ts); read-only, computed from the real scene ---

  materialOf(meshName: string): MaterialParams | null {
    const mesh = this.meshes().find((m) => m.name === meshName);
    const material = mesh ? editable(firstOf(mesh.material)) : null;
    return material ? this.getMaterial(material.uuid) : null;
  }

  meshName(meshId: string | null): string | null {
    return this.meshes().find((m) => m.uuid === meshId)?.name ?? null;
  }

  /** texture digests the texture asset shown on the preview plane (a MeshBasicMaterial's map). */
  textureDigest(): TextureDigest | null {
    for (const mesh of this.meshes()) {
      const m = firstOf(mesh.material);
      if (m instanceof THREE.MeshBasicMaterial && m.map) return digest(m.map);
    }
    return null;
  }

  /** materialTextureDigest digests the base-colour texture on a mesh's material, or null when it is bare. */
  materialTextureDigest(meshName: string): TextureDigest | null {
    const mesh = this.meshes().find((m) => m.name === meshName);
    const map = mesh ? editable(firstOf(mesh.material))?.map : null;
    return map ? digest(map) : null;
  }

  screenPositionOf(meshName: string): { x: number; y: number } | null {
    const mesh = this.meshes().find((m) => m.name === meshName);
    if (!mesh) return null;
    const centre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const p = this.viewport.project(centre);
    if (!p) return null;
    // A point where the mesh is the first hit is not enough: the gizmo sits on the object's origin and
    // takes the press before the studio sees it, so a candidate its pickers cover would click nothing.
    const pickers = this.pickers(this.controls.mode);
    for (const [dx, dy] of spiral(60, 6)) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (this.pick(q.x, q.y) !== mesh) continue;
      this.raycaster.setFromCamera(this.viewport.toNdc(q.x, q.y), this.viewport.camera);
      if (this.raycaster.intersectObjects(pickers, false).length === 0) return q;
    }
    return null;
  }

  gizmoHandleScreenPosition(axis: 'x' | 'y' | 'z'): { x: number; y: number } | null {
    const picker = this.pickers('translate').find((o) => o.name === axis.toUpperCase());
    if (!picker) return null;
    this.controls.getHelper().updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(picker).getCenter(new THREE.Vector3());
    return this.viewport.project(centre);
  }

  emptySpaceScreenPosition(): { x: number; y: number } {
    const rect = this.viewport.canvas.getBoundingClientRect();
    const corners: Array<[number, number]> = [
      [0.12, 0.12],
      [0.88, 0.12],
      [0.12, 0.88],
      [0.88, 0.88],
      [0.5, 0.08],
    ];
    const candidates = corners.map(([fx, fy]) => ({ x: rect.left + fx * rect.width, y: rect.top + fy * rect.height }));
    const mode = this.controls.mode;
    for (const c of candidates) {
      this.raycaster.setFromCamera(this.viewport.toNdc(c.x, c.y), this.viewport.camera);
      const hitModel = this.raycaster.intersectObjects(this.meshes(), false).length > 0;
      const hitGizmo = this.raycaster.intersectObjects(this.pickers(mode), false).length > 0;
      if (!hitModel && !hitGizmo) return c;
    }
    return candidates[0] ?? { x: rect.left + 10, y: rect.top + 10 };
  }

  // --- internals ---

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.press = { x: e.clientX, y: e.clientY, onGizmo: this.controls.axis !== null || this.controls.dragging };
  }

  private onPointerUp(e: PointerEvent): void {
    const press = this.press;
    this.press = null;
    if (!press || press.onGizmo || e.button !== 0) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX) return;
    const hit = this.pick(e.clientX, e.clientY);
    this.events?.onPick(hit ? hit.uuid : null);
  }

  private pick(clientX: number, clientY: number): THREE.Mesh | null {
    this.raycaster.setFromCamera(this.viewport.toNdc(clientX, clientY), this.viewport.camera);
    const hit = this.raycaster.intersectObjects(this.meshes(), false)[0];
    return hit && hit.object instanceof THREE.Mesh ? hit.object : null;
  }

  private meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    this.viewport.object?.traverse((o) => {
      if (o instanceof THREE.Mesh) out.push(o);
    });
    return out;
  }

  private materials(): Map<string, Editable> {
    const out = new Map<string, Editable>();
    for (const mesh of this.meshes()) {
      for (const m of asArray(mesh.material)) {
        const e = editable(m);
        if (e) out.set(e.uuid, e);
      }
    }
    return out;
  }

  /** pickers are the invisible meshes TransformControls raycasts against for a mode, named by axis. */
  private pickers(mode: GizmoMode): THREE.Object3D[] {
    let found: THREE.Object3D[] = [];
    this.controls.getHelper().traverse((o) => {
      if (o.type === 'TransformControlsGizmo' && 'picker' in o) {
        const picker = (o as { picker: Record<GizmoMode, THREE.Object3D> }).picker;
        found = picker[mode].children;
      }
    });
    return found;
  }
}

/** digest hashes a scene texture's pixels; its image is a canvas, an ImageBitmap or an <img>. */
function digest(tex: THREE.Texture): TextureDigest | null {
  const image = tex.image as (CanvasImageSource & { width: number; height: number }) | null;
  return image ? digestImage(image) : null;
}

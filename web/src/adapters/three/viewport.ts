import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneObject, ViewportPort } from '../../app/ports';
import { asObject3D } from './scene-object';

// The 3D viewport: a lit scene with a ground grid and an orbit camera, holding one asset object at a time.
// Kept deliberately close to wowd's client renderer (same three.js, same up axis, same metre scale) so what
// you see here is what the game will show once the asset is wired in.
//
// The editor (editor.ts) builds on it through a few accessors and two hooks rather than by reaching into
// privates: what happens when the object changes, and what runs every frame.
export class Viewport implements ViewportPort {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly renderer: THREE.WebGLRenderer;
  private current: THREE.Object3D | null = null;
  private readonly frameHooks = new Set<() => void>();
  private readonly objectHooks = new Set<(obj: THREE.Object3D | null) => void>();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(55, this.aspect(), 0.05, 2000);
    this.camera.position.set(3, 2.4, 3.6);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1, 0);

    // A one-metre grid so scale is legible — a character is about two of these tall, an item a fraction.
    const grid = new THREE.GridHelper(20, 20, 0x39465c, 0x1e2633);
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(1));
    this.scene.add(new THREE.HemisphereLight(0x9fb8d6, 0x2a2a20, 0.9));
    const sun = new THREE.DirectionalLight(0xffe9c4, 1.2);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      for (const hook of this.frameHooks) hook();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** show replaces whatever is in the viewport with obj and frames the camera on it. */
  show(obj: SceneObject | null): void {
    if (this.current) {
      this.scene.remove(this.current);
      disposeTree(this.current);
    }
    this.current = obj ? asObject3D(obj) : null;
    if (this.current) {
      this.scene.add(this.current);
      this.frameOn(this.current);
    }
    for (const hook of this.objectHooks) hook(this.current);
  }

  /** object is what is currently in the viewport, for exporting and editing. */
  get object(): THREE.Object3D | null {
    return this.current;
  }

  /** onFrame runs fn before every render — for helpers that must follow a moving object. */
  onFrame(fn: () => void): void {
    this.frameHooks.add(fn);
  }

  /** onObjectChanged runs fn after show(), with the new object or null. */
  onObjectChanged(fn: (obj: THREE.Object3D | null) => void): void {
    this.objectHooks.add(fn);
  }

  /** project maps a world point to client (page) pixel coordinates; null when it is behind the camera. */
  /**
   * freshen brings every world matrix up to date without waiting for the render loop. Picking and
   * projection read matrixWorld; between an edit and the next frame — a long gap under software rendering —
   * they would otherwise describe where things were, not where they are.
   */
  freshen(): void {
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
  }

  project(world: THREE.Vector3): { x: number; y: number } | null {
    this.camera.updateMatrixWorld();
    const ndc = world.clone().project(this.camera);
    if (ndc.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height };
  }

  /** toNdc maps client pixel coordinates to normalised device coordinates for a raycast. */
  toNdc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * framed reports whether the camera looks at the object's centre with the whole of it in view — what
   * frameOn promised, checked from the outside so a browser test need not trust the promise.
   */
  framed(): boolean {
    if (!this.current) return false;
    const box = new THREE.Box3().setFromObject(this.current);
    if (box.isEmpty()) return false;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (this.controls.target.distanceTo(center) > 1e-3 * Math.max(1, size.length())) return false;
    this.camera.updateMatrixWorld();
    for (const corner of corners(box)) {
      const p = corner.project(this.camera);
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) return false;
    }
    return true;
  }

  private frameOn(obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(radius * 2.2, radius * 1.6, radius * 2.4));
    this.camera.near = radius / 100;
    this.camera.far = radius * 100;
    this.camera.updateProjectionMatrix();
    // Damping would otherwise ease the camera toward the new target over several frames; a framed view is
    // what the designer expects immediately after import.
    this.controls.update();
  }

  private aspect(): number {
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect();
    this.camera.updateProjectionMatrix();
  }
}

function corners(box: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
    }
  }
  return out;
}

// three.js does not free GPU memory on its own; a studio that swaps assets all day would leak without this.
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

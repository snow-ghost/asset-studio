import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneObject, ViewportPort } from '../../app/ports';
import { asObject3D } from './scene-object';

// The 3D viewport: a lit scene with a ground grid and an orbit camera, holding one asset object at a time.
// Kept deliberately close to wowd's client renderer (same three.js, same up axis, same metre scale) so what
// you see here is what the game will show once the asset is wired in.
export class Viewport implements ViewportPort {
  readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private current: THREE.Object3D | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
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
  }

  /** object is what is currently in the viewport, for exporting. */
  get object(): THREE.Object3D | null {
    return this.current;
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

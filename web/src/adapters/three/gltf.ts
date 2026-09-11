import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ImportFormat } from '../../domain/import';
import type { ModelCodec, SceneObject } from '../../app/ports';
import { asObject3D } from './scene-object';

// glTF is the exchange format (AGENTS.md, invariant 5): what is exported here is byte for byte what
// studiod stores and what wowd's client loads with the same GLTFLoader. No studio-only format in between.
export class GltfCodec implements ModelCodec {
  export(obj: SceneObject): Promise<ArrayBuffer> {
    return exportGlb(asObject3D(obj));
  }

  async load(url: string): Promise<THREE.Object3D> {
    return unwrap(await new GLTFLoader().loadAsync(url));
  }

  /** import parses bytes already checked by the domain. GLTFLoader.parse takes a GLB or JSON glTF buffer alike. */
  import(bytes: ArrayBuffer, _format: ImportFormat): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().parse(
        bytes,
        '',
        (gltf) => resolve(unwrap(gltf)),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  }
}

/**
 * unwrap picks the object the studio edits out of what the loader produced.
 *
 * The loader always returns a Group ("Scene") holding the file's root nodes, and the exporter always
 * wraps the object it is handed in a node of its own. Without this step every save → load cycle would
 * nest one more identity Group around the model and the root TRS the designer edited would sit one level
 * deeper each time. So: a scene with a single child and no transform of its own is that child; a scene
 * with several roots stays a Group (the exporter's wrapper becomes that single child on the next load).
 *
 * The animation clips ride on the object (Object3D.animations) because that is the only way they reach
 * the exporter; left on the GLTF result they would be dropped at the first save (REQ-001-6).
 */
export function unwrap(gltf: GLTF): THREE.Object3D {
  const scene: THREE.Object3D = gltf.scene;
  const only = scene.children.length === 1 ? scene.children[0] : undefined;
  const root = only && isIdentity(scene) ? scene.remove(only) && only : scene;
  root.animations = gltf.animations;
  return root;
}

function isIdentity(obj: THREE.Object3D): boolean {
  return obj.position.lengthSq() === 0 && obj.quaternion.equals(new THREE.Quaternion()) && obj.scale.equals(new THREE.Vector3(1, 1, 1));
}

export function exportGlb(obj: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      obj,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('expected a binary glb'));
      },
      (err) => reject(new Error(String(err))),
      { binary: true, animations: obj.animations },
    );
  });
}

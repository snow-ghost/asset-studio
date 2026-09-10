import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ModelCodec, SceneObject } from '../../app/ports';
import { asObject3D } from './scene-object';

// glTF is the exchange format (AGENTS.md, invariant 5): what is exported here is byte for byte what
// studiod stores and what wowd's client loads with the same GLTFLoader. No studio-only format in between.
export class GltfCodec implements ModelCodec {
  export(obj: SceneObject): Promise<ArrayBuffer> {
    return exportGlb(asObject3D(obj));
  }

  async load(url: string): Promise<THREE.Object3D> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return gltf.scene;
  }
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
      { binary: true },
    );
  });
}

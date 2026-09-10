import * as THREE from 'three';
import type { SceneObject, TextureCodec, TextureSource } from '../../app/ports';

// A texture asset is a PNG: encoded from the canvas behind its placeholder, shown back as a two-metre
// plane. PNG because that is what wowd's client loads with TextureLoader (AGENTS.md, invariant 5).
export class PngTextureCodec implements TextureCodec {
  encode(source: TextureSource): Promise<ArrayBuffer> {
    if (!(source instanceof HTMLCanvasElement)) {
      return Promise.reject(new Error('a texture is encoded from a canvas'));
    }
    return canvasToPng(source);
  }

  load(url: string): Promise<SceneObject> {
    return texturePlane(url);
  }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('canvas has no image'));
      blob.arrayBuffer().then(resolve).catch(reject);
    }, 'image/png');
  });
}

export async function texturePlane(url: string): Promise<THREE.Object3D> {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.position.y = 1;
  return mesh;
}

import * as THREE from 'three';
import type { Rgba } from '../../domain/texture';
import type { SceneObject, TextureCodec, TextureHandle, TextureSource } from '../../app/ports';

// A texture in the studio takes several forms — a recipe's RGBA, a PNG's bytes, a stored asset, a preview
// on a plane — and this codec moves pixels between them. Every source is a canvas: one shape whose width,
// height and pixels are all readable, which is what the digest helpers and the exporter both need. PNG is
// the on-disk format because that is what wowd's client loads with TextureLoader (invariant 5).
export class CanvasTextureCodec implements TextureCodec {
  fromPixels(rgba: Rgba): TextureSource {
    const canvas = blank(rgba.width, rgba.height);
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0);
    return canvas;
  }

  async fromBytes(bytes: ArrayBuffer): Promise<TextureSource> {
    // createImageBitmap decodes the PNG off the main thread; drawing it into a canvas gives the one shape.
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = blank(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  }

  async fromUrl(url: string): Promise<TextureSource> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return this.fromBytes(await res.arrayBuffer());
  }

  encode(source: TextureSource): Promise<ArrayBuffer> {
    return canvasToPng(asCanvas(source));
  }

  /** plane is the preview: the texture on a two-metre quad standing on the ground, as in a paint program. */
  plane(source: TextureSource): SceneObject {
    const tex = new THREE.CanvasTexture(asCanvas(source));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.y = 1;
    mesh.name = 'placeholder_texture';
    return mesh;
  }
}

/**
 * textureFrom makes a scene texture from pixels in glTF orientation: flipY off, so the exporter writes the
 * canvas as it is and a reload returns the same rows. A CanvasTexture defaults to flipY on, which the
 * exporter would honour by flipping the written PNG — and the round trip's pixels would no longer match.
 */
export function textureFrom(source: TextureSource): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(asCanvas(source));
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function blank(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function asCanvas(source: TextureSource): HTMLCanvasElement {
  if (source instanceof HTMLCanvasElement) return source;
  throw new Error('a texture source must be a canvas');
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('canvas has no image'));
      blob.arrayBuffer().then(resolve).catch(reject);
    }, 'image/png');
  });
}

/** asTextureHandle exposes a scene texture's uuid to the app as an opaque handle (app/ports). */
export function asTextureHandle(tex: THREE.Texture): TextureHandle {
  return tex;
}

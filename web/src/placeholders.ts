import * as THREE from 'three';
import type { Kind } from './api';

// Placeholder geometry per asset kind. These are the starting point a designer replaces — a capsule for a
// body, a box for an item, a noisy patch for terrain — sized in metres to match wowd's world so scale reads
// true from the first save. They are also exactly what wowd renders today (capsules), so wiring the manifest
// in changes nothing visually until real geometry replaces them: a safe first integration.
const STONE = 0x8a94a6;

export function makePlaceholder(kind: Kind): THREE.Object3D {
  switch (kind) {
    case 'character':
      return body(0.3, 1.2, 0x6f9ceb);
    case 'creature':
      return body(0.42, 0.7, 0xcc6f6f);
    case 'item':
      return item();
    case 'landscape':
      return landscape();
    case 'texture':
      return texturePreview();
  }
}

function body(radius: number, length: number, color: number): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(radius, length, 8, 16);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  mesh.position.y = radius + length / 2; // feet on the ground
  mesh.name = 'placeholder_body';
  return mesh;
}

function item(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.12, 0.7, 0.12);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: STONE, metalness: 0.3, roughness: 0.5 }));
  mesh.position.y = 0.5;
  mesh.name = 'placeholder_item';
  return mesh;
}

// A small terrain patch with gentle noise, the same shape wowd's zone heightmaps describe. A real landscape
// asset would carry the zone's actual heights (see docs/integration-with-wowd.md); this is the editable stub.
function landscape(): THREE.Mesh {
  const size = 8;
  const segs = 32;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = 0.4 * Math.sin(x * 0.6) * Math.cos(z * 0.5) + 0.15 * Math.sin(x * 1.7 + z);
    pos.setY(i, h);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a5a40, roughness: 0.95, flatShading: false }));
  mesh.name = 'placeholder_landscape';
  return mesh;
}

function texturePreview(): THREE.Mesh {
  const tex = new THREE.CanvasTexture(makeTextureCanvas());
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex }),
  );
  mesh.position.y = 1;
  mesh.name = 'placeholder_texture';
  return mesh;
}

// makeTextureCanvas draws a procedural placeholder texture. A texture asset is saved as the PNG this canvas
// produces (see main.ts), not as a model.
export function makeTextureCanvas(size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const cells = 8;
  const step = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const t = (Math.sin(x * 1.3) * Math.cos(y * 1.1) + 1) / 2;
      const shade = Math.floor(60 + t * 120);
      ctx.fillStyle = `rgb(${shade}, ${shade + 20}, ${shade + 8})`;
      ctx.fillRect(x * step, y * step, step, step);
    }
  }
  return canvas;
}

import * as THREE from 'three';
import type { Kind } from '../../domain/asset';
import type { Placeholders, SceneObject } from '../../app/ports';

// Placeholder geometry per model kind. These are the starting point a designer replaces — a capsule for a
// body, a box for an item, a noisy patch for terrain — sized in metres to match wowd's world so scale reads
// true from the first save. They are also exactly what wowd renders today (capsules), so wiring the manifest
// in changes nothing visually until real geometry replaces them: a safe first integration.
//
// A texture has no placeholder geometry: the session starts a new texture from a recipe (domain/texture) and
// shows it as a plane through the texture codec, so 'texture' is never asked of this port.
const STONE = 0x8a94a6;

export const threePlaceholders: Placeholders = { make: makePlaceholder };

export function makePlaceholder(kind: Kind): SceneObject {
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
      // Unreachable: a texture is made from a recipe, not from a placeholder mesh. A blank plane rather than
      // a throw keeps the exhaustive switch total without a crash path if the flow ever changes.
      return blankPlane();
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a5a40, roughness: 0.95 }));
  mesh.name = 'placeholder_landscape';
  return mesh;
}

function blankPlane(): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  mesh.position.y = 1;
  mesh.name = 'placeholder_texture';
  return mesh;
}

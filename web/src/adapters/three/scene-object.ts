import * as THREE from 'three';
import type { SceneObject } from '../../app/ports';

// The app layer holds scene objects as an opaque SceneObject. Every three.js adapter takes them back
// through this one check rather than a cast, so a foreign object fails loudly here instead of somewhere
// deep inside three.js.
export function asObject3D(obj: SceneObject): THREE.Object3D {
  if (obj instanceof THREE.Object3D) return obj;
  throw new Error(`not a three.js object: ${obj.name}`);
}

/** measure is the object's world-space bounding box size in metres, or zeros for an empty object. */
export function measure(obj: THREE.Object3D): { x: number; y: number; z: number } {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return { x: 0, y: 0, z: 0 };
  const size = box.getSize(new THREE.Vector3());
  return { x: size.x, y: size.y, z: size.z };
}

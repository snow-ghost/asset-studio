import type { GizmoMode } from './app/ports';
import type { SessionState } from './app/session';
import type { MaterialParams, ModelStats, Transform } from './domain/model';
import type { TextureParams } from './domain/texture';

/**
 * The window hook the browser tests read (web/tests/e2e). One declaration, here, because `declare global`
 * is global: two specs each describing `window.__studio` their own way would drift apart.
 *
 * Tests read rendered state through this rather than by inspecting pixels: a pixel comparison fails on a
 * font change and says nothing about whether the placeholder is the right size in metres. Everything here
 * is read-only — a hook that moved the model would let a test pass without a user ever being able to.
 */
export interface StudioDebug {
  /** What is in the viewport: its name and bounding box in metres, or null when empty. */
  object(): { name: string; kind: string; size: { x: number; y: number; z: number } } | null;
  state(): SessionState;
  /** The API base the page was built with: '' means same origin as the page. */
  apiBase: string;

  // --- the editor (M1) ---
  stats(): ModelStats | null;
  transform(): Transform | null;
  /** The material of the mesh with that name, as the panel would show it. */
  material(meshName: string): MaterialParams | null;
  selectedMeshName(): string | null;
  gizmoMode(): GizmoMode;
  /** Whether the camera is looking at the model's centre with the whole model inside the view. */
  framed(): boolean;
  /** Client (page) coordinates of a mesh's centre, to click it; null if it is not on screen. */
  screenPositionOf(meshName: string): { x: number; y: number } | null;
  /** Client coordinates of the translate gizmo's arrow for an axis, to drag it. */
  gizmoHandleScreenPosition(axis: 'x' | 'y' | 'z'): { x: number; y: number } | null;
  /** Client coordinates of a point on the canvas where a click hits nothing. */
  emptySpaceScreenPosition(): { x: number; y: number };

  // --- textures (M2) ---
  /** The texture asset in the viewport: its size and a digest of its pixels (rows top first), or null. */
  texture(): { width: number; height: number; digest: string } | null;
  /** The recipe of the texture in the viewport, when it is procedural. */
  procedural(): TextureParams | null;
  /** The base colour texture on a mesh's material: size and pixel digest in the same orientation, or null when bare. */
  materialTexture(meshName: string): { width: number; height: number; digest: string } | null;
}

declare global {
  interface Window {
    __studio?: StudioDebug;
  }
}

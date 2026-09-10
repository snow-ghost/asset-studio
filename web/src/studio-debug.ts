import type { SessionState } from './app/session';

/**
 * The window hook the browser tests read (web/tests/e2e). One declaration, here, because `declare global`
 * is global: two specs each describing `window.__studio` their own way would drift apart.
 *
 * Tests read rendered state through this rather than by inspecting pixels: a pixel comparison fails on a
 * font change and says nothing about whether the placeholder is the right size in metres.
 */
export interface StudioDebug {
  /** What is in the viewport: its name and bounding box in metres, or null when empty. */
  object(): { name: string; kind: string; size: { x: number; y: number; z: number } } | null;
  state(): SessionState;
  /** The API base the page was built with: '' means same origin as the page. */
  apiBase: string;
}

declare global {
  interface Window {
    __studio?: StudioDebug;
  }
}

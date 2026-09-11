import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { MaterialParams, ModelStats, Transform } from '../../src/domain/model';

/**
 * The steps the editor scenarios (features/editor/*.feature) are made of, in Playwright terms. Everything the
 * studio shows is read through window.__studio (src/studio-debug.ts) — computed from the real scene, never
 * from pixels — and everything the designer does is a real gesture on the real page: a file picked, a field
 * typed, a mesh clicked where it is on screen, a gizmo handle dragged.
 */

/** fixture is the absolute path of a test model in testdata/, the directory next to web/ (where the config lives). */
export function fixture(file: string): string {
  const configFile = test.info().config.configFile ?? '';
  const webDir = configFile.slice(0, configFile.lastIndexOf('/'));
  return `${webDir}/../testdata/${file}`;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export async function clearAssets(request: APIRequestContext): Promise<void> {
  const assets = (await (await request.get('/api/assets')).json()) as Array<{ id: string }>;
  for (const a of assets) await request.delete(`/api/assets/${a.id}`);
}

export async function openStudio(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__studio?.object() ?? null)).not.toBeNull();
}

// --- reading ---

export const read = {
  stats: (page: Page): Promise<ModelStats | null> => page.evaluate(() => window.__studio?.stats() ?? null),
  transform: (page: Page): Promise<Transform | null> => page.evaluate(() => window.__studio?.transform() ?? null),
  material: (page: Page, mesh: string): Promise<MaterialParams | null> =>
    page.evaluate((name) => window.__studio?.material(name) ?? null, mesh),
  selectedMesh: (page: Page): Promise<string | null> => page.evaluate(() => window.__studio?.selectedMeshName() ?? null),
  gizmoMode: (page: Page): Promise<string | null> => page.evaluate(() => window.__studio?.gizmoMode() ?? null),
  framed: (page: Page): Promise<boolean> => page.evaluate(() => window.__studio?.framed() ?? false),
  dirty: (page: Page): Promise<boolean> => page.evaluate(() => window.__studio?.state().dirty ?? false),
  activeId: (page: Page): Promise<string | null> => page.evaluate(() => window.__studio?.state().activeId ?? null),
  canUndo: (page: Page): Promise<boolean> => page.evaluate(() => window.__studio?.state().canUndo ?? false),
  canRedo: (page: Page): Promise<boolean> => page.evaluate(() => window.__studio?.state().canRedo ?? false),
  objectName: (page: Page): Promise<string | null> => page.evaluate(() => window.__studio?.object()?.name ?? null),
};

// --- doing ---

/** importFile picks a fixture through the real file input, as a drag onto the page would. */
export async function importFile(page: Page, file: string, kind: string): Promise<void> {
  await page.selectOption('#kind', kind);
  await page.setInputFiles('#import', fixture(file));
}

/** importModel imports and waits until the fixture's three meshes are in the viewport. */
export async function importModel(page: Page, file = 'moss_boar.glb', kind = 'creature'): Promise<void> {
  await importFile(page, file, kind);
  await expect.poll(async () => (await read.stats(page))?.meshes).toBe(3);
}

/** setField types into a numeric field and commits it the way a designer does: Enter. */
export async function setField(page: Page, id: string, value: string): Promise<void> {
  const field = page.locator(`#${id}`);
  await field.fill(value);
  await field.press('Enter');
}

/**
 * typeInto presses the keys one by one, as a designer does. Unlike fill() it lets the browser's own rules
 * apply: a number field silently drops letters, which is the first line of refusal.
 */
export async function typeInto(page: Page, id: string, text: string): Promise<void> {
  const field = page.locator(`#${id}`);
  await field.click();
  await field.press('Control+a');
  await field.pressSequentially(text);
  await field.press('Enter');
}

export async function setPosition(page: Page, v: Vec3): Promise<void> {
  await setField(page, 'pos-x', String(v.x));
  await setField(page, 'pos-y', String(v.y));
  await setField(page, 'pos-z', String(v.z));
  await expect.poll(async () => (await read.transform(page))?.position).toEqual(v);
}

export async function setRotation(page: Page, v: Vec3): Promise<void> {
  await setField(page, 'rot-x', String(v.x));
  await setField(page, 'rot-y', String(v.y));
  await setField(page, 'rot-z', String(v.z));
  await expect.poll(async () => (await read.transform(page))?.rotation).toEqual(v);
}

export async function setScale(page: Page, v: Vec3): Promise<void> {
  await setField(page, 'scl-x', String(v.x));
  await setField(page, 'scl-y', String(v.y));
  await setField(page, 'scl-z', String(v.z));
  await expect.poll(async () => (await read.transform(page))?.scale).toEqual(v);
}

/** blurFields takes the focus out of the panel so the studio's keyboard shortcuts, not the field's, get the keys. */
export async function blurFields(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

export async function press(page: Page, keys: string, times = 1): Promise<void> {
  await blurFields(page);
  for (let i = 0; i < times; i++) await page.keyboard.press(keys);
}

/** clickMesh clicks where the mesh is on screen and waits for the selection to land on it. */
export async function clickMesh(page: Page, mesh: string): Promise<void> {
  const at = await page.evaluate((name) => window.__studio?.screenPositionOf(name) ?? null, mesh);
  expect(at, `${mesh} must be clickable on screen`).not.toBeNull();
  expect(at, `a clickable point for mesh ${mesh}`).not.toBeNull();
  if (!at) return;
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => read.selectedMesh(page)).toBe(mesh);
}

export async function clickEmptySpace(page: Page): Promise<void> {
  const at = await page.evaluate(() => window.__studio?.emptySpaceScreenPosition() ?? null);
  expect(at).not.toBeNull();
  if (!at) return;
  await page.mouse.click(at.x, at.y);
}

/** dragGizmoX is a real drag of the translate gizmo's X arrow, 80 px to the right. */
export async function dragGizmoX(page: Page): Promise<void> {
  await blurFields(page);
  await expect.poll(() => read.gizmoMode(page)).toBe('translate');
  const at = await page.evaluate(() => window.__studio?.gizmoHandleScreenPosition('x') ?? null);
  expect(at, 'the X handle must be on screen').not.toBeNull();
  if (!at) return;
  // Hover first so the controls know which handle the pointer is over before the button goes down.
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(50);
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 80, at.y, { steps: 10 });
  await page.mouse.up();
}

export async function setMaterial(page: Page, m: { color?: string; metalness?: number; roughness?: number }): Promise<void> {
  // fill() on a colour input sets the value and fires input and change itself — one edit, one command.
  if (m.color !== undefined) await page.locator('#mat-color').fill(m.color);
  if (m.metalness !== undefined) await setField(page, 'mat-metalness', String(m.metalness));
  if (m.roughness !== undefined) await setField(page, 'mat-roughness', String(m.roughness));
}

export async function saveAs(page: Page, name: string, wowdRef?: string): Promise<void> {
  await page.fill('#name', name);
  if (wowdRef !== undefined) await page.fill('#wowdRef', wowdRef);
  await page.click('#save');
  await expect(page.locator('#status')).toHaveText(`saved ${name}`);
}

export async function openFromSidebar(page: Page, name: string): Promise<void> {
  await page.locator('#assetList li', { hasText: name }).locator('div').first().click();
}

// --- asserting ---

/** expectHex compares two "#rrggbb" colours within one step per channel: an 8-bit round trip may wobble by one. */
export function expectHex(actual: string | undefined, expected: string): void {
  expect(actual, 'colour present').toBeDefined();
  if (!actual) return;
  const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = channels(actual);
  const e = channels(expected);
  for (let i = 0; i < 3; i++) expect(Math.abs((a[i] ?? 0) - (e[i] ?? 0)), `${actual} vs ${expected}`).toBeLessThanOrEqual(1);
}

export async function expectMaterial(page: Page, mesh: string, want: { color: string; metalness: number; roughness: number }): Promise<void> {
  const m = await read.material(page, mesh);
  expect(m, `material of ${mesh}`).not.toBeNull();
  expectHex(m?.color, want.color);
  expect(m?.metalness).toBeCloseTo(want.metalness, 3);
  expect(m?.roughness).toBeCloseTo(want.roughness, 3);
}

export function expectVec(actual: Vec3 | undefined, want: Vec3, digits = 4): void {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(want.x, digits);
  expect(actual?.y).toBeCloseTo(want.y, digits);
  expect(actual?.z).toBeCloseTo(want.z, digits);
}

export async function expectModified(page: Page, modified: boolean): Promise<void> {
  const marker = page.locator('#dirty');
  if (modified) {
    await expect(marker).toBeVisible();
    await expect(marker).toHaveText('● modified');
    await expect.poll(() => page.title()).toMatch(/^● /);
  } else {
    await expect(marker).toBeHidden();
    await expect.poll(() => page.title()).toBe('Asset Studio');
  }
}


// --- textures (M2) ---

export interface TexDigest {
  width: number;
  height: number;
  digest: string;
}

export const tex = {
  shown: (page: Page): Promise<TexDigest | null> => page.evaluate(() => window.__studio?.texture() ?? null),
  procedural: (page: Page): Promise<Record<string, unknown> | null> =>
    page.evaluate(() => (window.__studio?.procedural() as Record<string, unknown> | null) ?? null),
  onMesh: (page: Page, mesh: string): Promise<TexDigest | null> =>
    page.evaluate((name) => window.__studio?.materialTexture(name) ?? null, mesh),
  size: (page: Page): Promise<{ width: number; height: number } | null> =>
    page.evaluate(() => window.__studio?.state().textureSize ?? null),
};

/** importTexture picks a PNG through the real file input and waits for it to reach the viewport. */
export async function importTexture(page: Page, file = 'bark_diffuse.png'): Promise<void> {
  await importFile(page, file, 'texture');
  await expect.poll(() => tex.shown(page)).not.toBeNull();
}

/** newTexture starts a fresh procedural texture and waits for its recipe to appear. */
export async function newTexture(page: Page): Promise<void> {
  await page.selectOption('#kind', 'texture');
  await page.click('#new');
  await expect(page.locator('#tex-recipe')).toBeVisible();
}

export async function setRecipe(page: Page, patch: Record<string, string | number>): Promise<void> {
  const ids: Record<string, string> = { type: 'tex-type', size: 'tex-res', colorA: 'tex-color-a', colorB: 'tex-color-b', scale: 'tex-scale', seed: 'tex-seed' };
  for (const [key, value] of Object.entries(patch)) {
    const id = ids[key];
    if (!id) continue;
    const control = page.locator(`#${id}`);
    if (id === 'tex-type' || id === 'tex-res') await control.selectOption(String(value));
    else if (id === 'tex-color-a' || id === 'tex-color-b') await control.fill(String(value));
    else await setField(page, id, String(value));
  }
}

/**
 * chooseTexture selects a base-colour texture for the current material by its label in the panel, and waits
 * until it is on the material: assigning fetches the asset's pixels and builds a texture asynchronously,
 * so the panel is only truthful once that landed — on a slow machine a step later would read too early.
 */
export async function chooseTexture(page: Page, label: string): Promise<void> {
  await page.locator('#mat-texture').selectOption({ label });
  await expect
    .poll(() => page.evaluate(() => window.__studio?.state().materialTexture?.present ?? null))
    .toBe(label !== 'none');
}

/** saveTextureFile saves the fixture PNG as a named texture asset, without going through the viewport preview edits. */
export async function saveTextureFile(page: Page, name: string, file = 'bark_diffuse.png'): Promise<void> {
  await importTexture(page, file);
  await saveAs(page, name);
}

export async function storedPayload(request: APIRequestContext, name: string): Promise<Buffer> {
  const assets = (await (await request.get('/api/assets')).json()) as Array<{ id: string; name: string }>;
  const asset = assets.find((a) => a.name === name);
  expect(asset, `asset ${name} exists`).toBeTruthy();
  const res = await request.get(`/api/assets/${asset?.id}/payload`);
  return Buffer.from(await res.body());
}

export function fixtureBytes(file: string): Buffer {
  return readFileSync(fixture(file));
}

/** pngDimensions reads width and height from a PNG's IHDR chunk (bytes 16..24, big-endian). */
export function pngDimensions(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

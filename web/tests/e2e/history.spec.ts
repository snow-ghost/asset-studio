import { expect, test } from '@playwright/test';
import {
  clearAssets,
  clickMesh,
  dragGizmoX,
  expectHex,
  expectVec,
  importModel,
  openStudio,
  press,
  read,
  saveAs,
  setField,
  setMaterial,
  setPosition,
} from './studio';

// Mirrors features/editor/history.feature (REQ-001-4).
test.describe('Undo and redo', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    await importModel(page);
  });

  test('@req-001-4 A move is undone and redone from the keyboard', async ({ page }) => {
    await setPosition(page, { x: 1, y: 0, z: 0 });
    await press(page, 'Control+z');
    await expect.poll(async () => (await read.transform(page))?.position).toEqual({ x: 0, y: 0, z: 0 });
    await press(page, 'Control+Shift+z');
    await expect.poll(async () => (await read.transform(page))?.position).toEqual({ x: 1, y: 0, z: 0 });
  });

  test('@req-001-4 A material edit is undone with the button', async ({ page }) => {
    await clickMesh(page, 'body');
    await setMaterial(page, { color: '#ff0000' });
    await expect.poll(async () => (await read.material(page, 'body'))?.color).toBe('#ff0000');
    await page.click('#undo');
    await expect.poll(async () => (await read.material(page, 'body'))?.color).not.toBe('#ff0000');
    expectHex((await read.material(page, 'body'))?.color, '#8b5a2b');
  });

  test('@req-001-4 A new edit after undo forgets the redo', async ({ page }) => {
    await setPosition(page, { x: 1, y: 0, z: 0 });
    await press(page, 'Control+z');
    await expect.poll(() => read.canRedo(page)).toBe(true);
    await setPosition(page, { x: 0, y: 2, z: 0 });
    expect(await read.canRedo(page)).toBe(false);
    await expect(page.locator('#redo')).toBeDisabled();
  });

  test('@req-001-4 Fifty steps can be undone', async ({ page }) => {
    test.slow();
    for (let i = 1; i <= 60; i++) {
      await setField(page, 'pos-x', String(Number((i * 0.1).toFixed(1))));
    }
    await expect.poll(async () => (await read.transform(page))?.position.x).toBeCloseTo(6.0, 3);
    await press(page, 'Control+z', 50);
    await expect.poll(async () => (await read.transform(page))?.position.x ?? NaN).toBeCloseTo(1.0, 3);
    expect(await read.canUndo(page)).toBe(false);
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('@req-001-4 One gizmo drag is one step', async ({ page }) => {
    await dragGizmoX(page);
    await expect.poll(async () => (await read.transform(page))?.position.x ?? 0).toBeGreaterThan(0);
    await press(page, 'Control+z');
    await expect.poll(async () => (await read.transform(page))?.position).toEqual({ x: 0, y: 0, z: 0 });
    expectVec((await read.transform(page))?.position, { x: 0, y: 0, z: 0 });
  });

  test('@req-001-4 Saving does not forget the history', async ({ page }) => {
    await setPosition(page, { x: 1, y: 0, z: 0 });
    await saveAs(page, 'moss_boar');
    await press(page, 'Control+z');
    await expect.poll(async () => (await read.transform(page))?.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

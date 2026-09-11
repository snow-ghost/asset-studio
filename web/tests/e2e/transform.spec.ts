import { expect, test } from '@playwright/test';
import { clearAssets, dragGizmoX, expectVec, importModel, openStudio, press, read, setPosition, setRotation, setScale, typeInto } from './studio';

// Mirrors features/editor/transform.feature (REQ-001-3).
test.describe('Moving, turning and scaling the model', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    await importModel(page);
  });

  test('@req-001-3 Typing into the transform fields moves the model', async ({ page }) => {
    await setPosition(page, { x: 1, y: 0, z: -2 });
    expectVec((await read.transform(page))?.position, { x: 1, y: 0, z: -2 });
    await setRotation(page, { x: 0, y: 90, z: 0 });
    expectVec((await read.transform(page))?.rotation, { x: 0, y: 90, z: 0 });
    await setScale(page, { x: 2, y: 2, z: 2 });
    await expect(page.locator('#size')).toHaveText('2.0 × 2.0 × 3.0 m');
  });

  test('@req-001-3 Dragging the gizmo updates the fields', async ({ page }) => {
    await dragGizmoX(page);
    await expect.poll(async () => (await read.transform(page))?.position.x ?? 0).toBeGreaterThan(0);
    const t = await read.transform(page);
    await expect(page.locator('#pos-x')).toHaveValue(String(Number((t?.position.x ?? 0).toFixed(4))));
    await expect(page.locator('#pos-y')).toHaveValue(String(Number((t?.position.y ?? 0).toFixed(4))));
    await expect(page.locator('#pos-z')).toHaveValue(String(Number((t?.position.z ?? 0).toFixed(4))));
  });

  test('@req-001-3 The gizmo modes follow W, E and R', async ({ page }) => {
    await press(page, 'e');
    await expect.poll(() => read.gizmoMode(page)).toBe('rotate');
    await expect(page.locator('#mode-rotate')).toHaveClass(/active/);
    await press(page, 'r');
    await expect.poll(() => read.gizmoMode(page)).toBe('scale');
    await press(page, 'w');
    await expect.poll(() => read.gizmoMode(page)).toBe('translate');
  });

  // Two lines of refusal: the browser's number field drops letters before they become a value, and the
  // studio refuses a value that is not a usable scale. Either way the model does not move.
  for (const row of [
    { value: '0', studioRefuses: true },
    { value: '-2', studioRefuses: true },
    { value: 'abc', studioRefuses: false },
  ]) {
    test(`@req-001-3 A field accepts only a usable number: "${row.value}"`, async ({ page }) => {
      await typeInto(page, 'scl-x', row.value);
      if (row.studioRefuses) await expect(page.locator('#status')).toContainText('scale above zero');
      expectVec((await read.transform(page))?.scale, { x: 1, y: 1, z: 1 });
      await expect(page.locator('#scl-x')).toHaveValue('1');
    });
  }
});

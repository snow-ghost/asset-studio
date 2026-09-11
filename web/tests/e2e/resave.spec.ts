import { expect, test } from '@playwright/test';
import {
  clearAssets,
  clickMesh,
  expectMaterial,
  expectVec,
  importModel,
  openFromSidebar,
  openStudio,
  read,
  saveAs,
  setMaterial,
  setPosition,
  setRotation,
  setScale,
} from './studio';

// Mirrors features/editor/resave.feature (REQ-001-6).
test.describe('Re-saving an edited model', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
  });

  test('@req-001-6 What was saved is what comes back', async ({ page, request }) => {
    await importModel(page);
    await page.fill('#wowdRef', 'moss_boar');
    await setPosition(page, { x: 1, y: 0.5, z: -2 });
    await setRotation(page, { x: 0, y: 90, z: 0 });
    await setScale(page, { x: 2, y: 2, z: 2 });
    await clickMesh(page, 'body');
    await setMaterial(page, { color: '#336699', metalness: 0.3, roughness: 0.4 });
    await expect.poll(async () => (await read.material(page, 'body'))?.roughness).toBeCloseTo(0.4, 3);

    await saveAs(page, 'moss_boar');
    const savedId = await read.activeId(page);
    expect(savedId).not.toBeNull();

    // Open it again: a fresh placeholder first, so what comes back is the stored file and not the object
    // that was already in the viewport.
    await page.click('#new');
    await expect.poll(() => read.activeId(page)).toBeNull();
    await openFromSidebar(page, 'moss_boar');
    await expect.poll(() => read.activeId(page)).toBe(savedId);
    await expect(page.locator('#status')).toHaveText('loaded moss_boar');

    const stats = await read.stats(page);
    expect(stats).toMatchObject({ meshes: 3, vertices: 48, indices: 60, textures: 1, animations: 1 });
    const t = await read.transform(page);
    expectVec(t?.position, { x: 1, y: 0.5, z: -2 });
    expectVec(t?.rotation, { x: 0, y: 90, z: 0 });
    expectVec(t?.scale, { x: 2, y: 2, z: 2 });
    await expectMaterial(page, 'body', { color: '#336699', metalness: 0.3, roughness: 0.4 });
    await expectMaterial(page, 'tusk_left', { color: '#e8e2d0', metalness: 0.1, roughness: 0.6 });

    const manifest = (await (await request.get('/api/manifest')).json()) as { assets: Array<{ wowdRef: string; assetId: string }> };
    expect(manifest.assets.find((a) => a.wowdRef === 'moss_boar')?.assetId).toBe(savedId);
  });

  test('@req-001-6 Saving again keeps the id', async ({ page }) => {
    await importModel(page);
    await saveAs(page, 'moss_boar');
    const firstId = await read.activeId(page);
    await setPosition(page, { x: 0, y: 1, z: 0 });
    await saveAs(page, 'moss_boar');
    await expect(page.locator('#assetList li', { hasText: 'moss_boar' })).toHaveCount(1);
    expect(await read.activeId(page)).toBe(firstId);
  });
});

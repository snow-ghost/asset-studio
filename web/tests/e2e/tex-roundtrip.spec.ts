import { expect, test } from '@playwright/test';
import { clearAssets, clickMesh, chooseTexture, importModel, openFromSidebar, openStudio, read, saveAs, saveTextureFile, tex } from './studio';

// Mirrors features/textures/roundtrip.feature (REQ-002-5).
test.describe('A texture survives saving the model', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    await saveTextureFile(page, 'bark');
    await importModel(page, 'moss_boar.glb', 'creature');
    await page.fill('#wowdRef', 'moss_boar');
  });

  test('@req-002-5 The assigned texture comes back embedded with the same pixels', async ({ page, request }) => {
    await clickMesh(page, 'tusk_left');
    await chooseTexture(page, 'bark');
    const bark = (await tex.onMesh(page, 'tusk_left'))?.digest;
    expect(bark).toBeTruthy();

    await saveAs(page, 'moss_boar', 'moss_boar');
    await page.click('#new');
    await openFromSidebar(page, 'moss_boar');
    await expect.poll(async () => (await read.stats(page))?.meshes).toBe(3);

    expect((await tex.onMesh(page, 'tusk_left'))?.digest).toBe(bark);
    const body = await tex.onMesh(page, 'body');
    expect(body?.digest).toBeTruthy();
    expect(body?.digest).not.toBe(bark);
    expect((await read.stats(page))?.textures).toBe(2);

    const manifest = (await (await request.get('/api/manifest')).json()) as { assets: Array<{ wowdRef: string; assetId: string }> };
    const entry = manifest.assets.find((a) => a.wowdRef === 'moss_boar');
    expect(entry?.assetId).toBe(await read.activeId(page));
  });
});

import { expect, test } from '@playwright/test';
import { clearAssets, clickMesh, chooseTexture, importModel, openStudio, press, saveTextureFile, tex } from './studio';

// Mirrors features/textures/assign.feature (REQ-002-4).
test.describe('Putting a texture on a material', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    await saveTextureFile(page, 'bark');
    await importModel(page, 'moss_boar.glb');
  });

  test('@req-002-4 A texture asset goes onto the selected mesh\'s material', async ({ page }) => {
    await clickMesh(page, 'tusk_left');
    await chooseTexture(page, 'bark');
    await expect.poll(async () => (await tex.onMesh(page, 'tusk_left'))?.digest).toBeTruthy();
    const bark = (await tex.onMesh(page, 'tusk_left'))?.digest;
    // The tusks share one material, so both wear it.
    expect((await tex.onMesh(page, 'tusk_right'))?.digest).toBe(bark);
    // The body has its own (embedded) texture, not bark's.
    const body = await tex.onMesh(page, 'body');
    expect(body?.digest).toBeTruthy();
    expect(body?.digest).not.toBe(bark);
  });

  test('@req-002-4 "none" takes the texture off and undo puts it back', async ({ page }) => {
    await clickMesh(page, 'tusk_left');
    await chooseTexture(page, 'bark');
    const bark = (await tex.onMesh(page, 'tusk_left'))?.digest;
    expect(bark).toBeTruthy();

    await chooseTexture(page, 'none');
    await expect.poll(() => tex.onMesh(page, 'tusk_left')).toBeNull();
    await press(page, 'Control+z');
    await expect.poll(async () => (await tex.onMesh(page, 'tusk_left'))?.digest).toBe(bark);
    await press(page, 'Control+z');
    await expect.poll(() => tex.onMesh(page, 'tusk_left')).toBeNull();
  });
});

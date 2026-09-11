import { expect, test } from '@playwright/test';
import { clearAssets, expectModified, newTexture, openFromSidebar, openStudio, pngDimensions, read, saveAs, setRecipe, storedPayload, tex } from './studio';

// Mirrors features/textures/procedural.feature (REQ-002-3).
test.describe('Procedural textures', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    await newTexture(page);
  });

  test('@req-002-3 A new texture is procedural and editable', async ({ page }) => {
    await expect(page.locator('#tex-type')).toHaveValue('checker');
    await expect(page.locator('#tex-res')).toHaveValue('256');
    await setRecipe(page, { type: 'stripes', size: 512 });
    await expect.poll(async () => (await tex.size(page))?.width).toBe(512);
    await expectModified(page, true);
  });

  test('@req-002-3 The same parameters give the same pixels, another seed different ones', async ({ page }) => {
    await setRecipe(page, { type: 'noise', seed: 7 });
    const remembered = (await tex.shown(page))?.digest;
    expect(remembered).toBeTruthy();
    await setRecipe(page, { seed: 8 });
    await expect.poll(async () => (await tex.shown(page))?.digest).not.toBe(remembered);
    await setRecipe(page, { seed: 7 });
    await expect.poll(async () => (await tex.shown(page))?.digest).toBe(remembered);
  });

  test('@req-002-3 Parameters survive saving and the texture is editable again', async ({ page, request }) => {
    await setRecipe(page, { type: 'noise', seed: 42, scale: 3 });
    await saveAs(page, 'moss_noise');
    await page.click('#new');
    await openFromSidebar(page, 'moss_noise');
    await expect.poll(() => read.objectName(page)).toBe('placeholder_texture');
    await expect(page.locator('#tex-type')).toHaveValue('noise');
    await expect(page.locator('#tex-seed')).toHaveValue('42');
    await expect(page.locator('#tex-scale')).toHaveValue('3');
    expect(pngDimensions(await storedPayload(request, 'moss_noise'))).toEqual({ width: 256, height: 256 });
  });
});

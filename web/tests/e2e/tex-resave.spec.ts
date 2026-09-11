import { expect, test } from '@playwright/test';
import { clearAssets, fixtureBytes, importTexture, newTexture, openFromSidebar, openStudio, read, saveAs, setRecipe, storedPayload } from './studio';

// Mirrors features/textures/resave.feature (REQ-002-7).
test.describe('Re-saving a texture keeps its bytes', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
  });

  test('@req-002-7 Saving an opened texture without changes leaves the payload untouched', async ({ page, request }) => {
    await importTexture(page, 'bark_diffuse.png');
    await saveAs(page, 'bark');

    await page.click('#new');
    await openFromSidebar(page, 'bark');
    await expect.poll(() => read.objectName(page)).toBe('placeholder_texture');
    await saveAs(page, 'bark');

    const stored = await storedPayload(request, 'bark');
    expect(stored.equals(fixtureBytes('bark_diffuse.png'))).toBe(true);
  });

  test('@req-002-7 Changing the recipe of a procedural texture changes the payload', async ({ page, request }) => {
    await newTexture(page);
    await setRecipe(page, { type: 'noise', seed: 5 });
    await saveAs(page, 'noise1');
    const before = await storedPayload(request, 'noise1');

    await page.click('#new');
    await openFromSidebar(page, 'noise1');
    await expect.poll(() => read.objectName(page)).toBe('placeholder_texture');
    await setRecipe(page, { seed: 99 });
    await saveAs(page, 'noise1');

    const after = await storedPayload(request, 'noise1');
    expect(after.equals(before)).toBe(false);
  });
});

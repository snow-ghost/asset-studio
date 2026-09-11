import { expect, test } from '@playwright/test';
import { clearAssets, fixtureBytes, importFile, importTexture, openStudio, read, saveAs, storedPayload, tex } from './studio';

// Mirrors features/textures/import.feature (REQ-002-1, REQ-002-2).
test.describe('Importing a texture', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
  });

  test('@req-002-1 A PNG from disk becomes a texture asset, byte for byte', async ({ page, request }) => {
    await importTexture(page, 'bark_diffuse.png');
    expect(await tex.size(page)).toEqual({ width: 64, height: 64 });
    expect(await read.framed(page)).toBe(true);
    await expect(page.locator('#name')).toHaveValue('bark_diffuse');
    await expect(page.locator('#tex-size')).toHaveText('64 × 64 px');

    await saveAs(page, 'bark_diffuse');
    const stored = await storedPayload(request, 'bark_diffuse');
    expect(stored.equals(fixtureBytes('bark_diffuse.png'))).toBe(true);
    const assets = (await (await request.get('/api/assets')).json()) as Array<{ name: string; kind: string; format: string }>;
    expect(assets.find((a) => a.name === 'bark_diffuse')).toMatchObject({ kind: 'texture', format: 'png' });
  });

  for (const row of [
    { file: 'not-a-model.bin', kind: 'texture', reason: 'not a glTF or PNG' },
    { file: 'bark_diffuse.png', kind: 'creature', reason: 'texture' },
    { file: 'moss_boar.glb', kind: 'texture', reason: 'PNG' },
  ]) {
    test(`@req-002-2 A file that is not a usable texture is refused: ${row.file} as ${row.kind}`, async ({ page }) => {
      await page.selectOption('#kind', 'texture');
      await page.click('#new');
      const before = await tex.shown(page);
      expect(before).not.toBeNull();

      await importFile(page, row.file, row.kind);
      await expect(page.locator('#status')).toContainText('import refused');
      await expect(page.locator('#status')).toContainText(row.reason);
    });
  }
});

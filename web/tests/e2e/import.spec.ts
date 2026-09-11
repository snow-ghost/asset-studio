import { expect, test } from '@playwright/test';
import { clearAssets, importFile, importModel, openStudio, read } from './studio';

// Mirrors features/editor/import.feature (REQ-001-1, REQ-001-2).
test.describe('Importing a model', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
  });

  test('@req-001-1 A GLB from disk appears in the viewport, framed and measured', async ({ page }) => {
    await importModel(page, 'moss_boar.glb');
    const stats = await read.stats(page);
    expect(stats).toMatchObject({ meshes: 3, vertices: 48 });
    expect(await read.framed(page)).toBe(true);
    await expect(page.locator('#name')).toHaveValue('moss_boar');
    await expect(page.locator('#size')).toHaveText('1.0 × 1.0 × 1.5 m');
  });

  test('@req-001-1 A self-contained glTF imports the same way', async ({ page }) => {
    await importModel(page, 'moss_boar.gltf');
    expect(await read.stats(page)).toMatchObject({ meshes: 3, vertices: 48 });
  });

  test('@req-001-1 A name the designer already typed is kept', async ({ page }) => {
    await page.fill('#name', 'boar_v2');
    await importModel(page, 'moss_boar.glb');
    await expect(page.locator('#name')).toHaveValue('boar_v2');
  });

  for (const row of [
    { file: 'not-a-model.bin', kind: 'creature', reason: 'not a glTF' },
    { file: 'external.gltf', kind: 'creature', reason: 'external files' },
    { file: 'draco.gltf', kind: 'creature', reason: 'compression' },
    { file: 'moss_boar.glb', kind: 'texture', reason: 'PNG' },
  ]) {
    test(`@req-001-2 A file the studio cannot use is refused with the reason: ${row.file} as ${row.kind}`, async ({ page }) => {
      // Given the viewport shows a creature placeholder
      await page.selectOption('#kind', 'creature');
      await page.click('#new');
      expect(await read.objectName(page)).toBe('placeholder_body');

      await importFile(page, row.file, row.kind);
      await expect(page.locator('#status')).toContainText('import refused');
      await expect(page.locator('#status')).toContainText(row.reason);
      expect(await read.objectName(page)).toBe('placeholder_body');
    });
  }
});

import { expect, test, type Page } from '@playwright/test';
import { clearAssets, expectModified, fixture, importModel, openFromSidebar, openStudio, read, saveAs, setPosition } from './studio';

// Mirrors features/editor/unsaved.feature (REQ-001-7).
test.describe('Unsaved changes are not lost silently', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    // Background: a saved placeholder called "other" to open later, then the imported model.
    await page.selectOption('#kind', 'creature');
    await page.click('#new');
    await saveAs(page, 'other');
    await importModel(page);
  });

  test('@req-001-7 An import marks the asset as modified', async ({ page }) => {
    await expectModified(page, true);
  });

  test('@req-001-7 Saving clears the mark', async ({ page }) => {
    await saveAs(page, 'moss_boar');
    await expectModified(page, false);
    await setPosition(page, { x: 1, y: 0, z: 0 });
    await expectModified(page, true);
  });

  const actions: Array<{ title: string; run: (page: Page) => Promise<void> }> = [
    { title: 'presses New placeholder', run: (page) => page.click('#new') },
    { title: 'imports the file "moss_boar.gltf"', run: (page) => page.setInputFiles('#import', fixture('moss_boar.gltf')) },
    { title: 'opens "other" from the sidebar', run: (page) => openFromSidebar(page, 'other') },
  ];
  for (const action of actions) {
    test(`@req-001-7 Leaving unsaved work asks first, and no means stay: ${action.title}`, async ({ page }) => {
      const asked = new Promise<string>((resolve) => {
        page.once('dialog', (dialog) => {
          resolve(dialog.message());
          void dialog.dismiss();
        });
      });
      await action.run(page);
      expect(await asked).toContain('Discard unsaved changes');
      // Still the model, still modified.
      await expect.poll(async () => (await read.stats(page))?.meshes).toBe(3);
      await expectModified(page, true);
    });
  }

  test('@req-001-7 Confirming discards the work', async ({ page }) => {
    page.once('dialog', (dialog) => void dialog.accept());
    await page.click('#new');
    await expect.poll(() => read.objectName(page)).toBe('placeholder_body');
    await expectModified(page, false);
  });
});

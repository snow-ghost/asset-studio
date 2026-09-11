import { expect, test } from '@playwright/test';
import { clearAssets, clickEmptySpace, clickMesh, expectHex, expectMaterial, importModel, openStudio, read, setMaterial } from './studio';

// Mirrors features/editor/material.feature (REQ-001-5).
test.describe('Picking a mesh and editing its material', () => {
  test.beforeEach(async ({ page, request }) => {
    await clearAssets(request);
    await openStudio(page);
    await importModel(page);
  });

  test('@req-001-5 Clicking a mesh selects it and shows its material', async ({ page }) => {
    await clickMesh(page, 'tusk_left');
    expect(await read.selectedMesh(page)).toBe('tusk_left');
    await expect(page.locator('#material')).toBeVisible();
    await expect(page.locator('#mesh-name')).toHaveText('tusk_left');
    await expect(page.locator('#material-name')).toHaveText('bone');
    expectHex(await page.locator('#mat-color').inputValue(), '#e8e2d0');
    await expect(page.locator('#mat-metalness')).toHaveValue('0.1');
    await expect(page.locator('#mat-roughness')).toHaveValue('0.6');
  });

  test('@req-001-5 Editing the material changes the selected mesh only', async ({ page }) => {
    await clickMesh(page, 'body');
    await setMaterial(page, { color: '#ff0000', metalness: 0.5, roughness: 0.2 });
    await expect.poll(async () => (await read.material(page, 'body'))?.roughness).toBeCloseTo(0.2, 3);
    await expectMaterial(page, 'body', { color: '#ff0000', metalness: 0.5, roughness: 0.2 });
    await expectMaterial(page, 'tusk_left', { color: '#e8e2d0', metalness: 0.1, roughness: 0.6 });
  });

  test('@req-001-5 A shared material changes on every mesh that uses it', async ({ page }) => {
    await clickMesh(page, 'tusk_left');
    await setMaterial(page, { color: '#00ff00' });
    await expect.poll(async () => (await read.material(page, 'tusk_right'))?.color).toBe('#00ff00');
  });

  test('@req-001-5 Clicking empty space clears the selection', async ({ page }) => {
    await clickMesh(page, 'body');
    await clickEmptySpace(page);
    await expect.poll(() => read.selectedMesh(page)).toBeNull();
    await expect(page.locator('#material')).toBeHidden();
  });
});

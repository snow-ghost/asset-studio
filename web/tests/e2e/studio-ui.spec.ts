import { expect, test, type Page } from '@playwright/test';
import type { StudioDebug } from '../../src/studio-debug';

/**
 * Mirrors features/e2e/studio-ui.feature. Rendered state is read through window.__studio (src/studio-debug.ts)
 * rather than from pixels: a pixel comparison fails on a font change and says nothing about whether the
 * placeholder is the right size in metres.
 */
type ViewportObject = ReturnType<StudioDebug['object']>;

async function studioObject(page: Page): Promise<ViewportObject> {
  return page.evaluate(() => window.__studio?.object() ?? null);
}

async function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__studio?.state().activeId ?? null);
}

async function openStudio(page: Page): Promise<void> {
  await page.goto('/');
  await expect.poll(() => studioObject(page)).not.toBeNull();
}

test.describe('The studio in the browser', () => {
  test.beforeEach(async ({ page, request }) => {
    // Background: an empty asset list. Each run has a fresh data directory (playwright.config.ts), but a
    // test that saved something must not leak into the next, so whatever is there is deleted.
    const res = await request.get('/api/assets');
    const assets = (await res.json()) as Array<{ id: string }>;
    for (const a of assets) await request.delete(`/api/assets/${a.id}`);
    await openStudio(page);
  });

  // @req-000-11 — placeholders sized in metres, matching src/adapters/three/placeholders.ts.
  const placeholders: Array<{ kind: string; name: string; check: (s: { x: number; y: number; z: number }) => void }> = [
    { kind: 'character', name: 'placeholder_body', check: (s) => expect(s.y).toBeCloseTo(1.8, 1) },
    { kind: 'creature', name: 'placeholder_body', check: (s) => expect(s.y).toBeCloseTo(1.54, 1) },
    { kind: 'item', name: 'placeholder_item', check: (s) => expect(s.y).toBeCloseTo(0.7, 1) },
    {
      kind: 'landscape',
      name: 'placeholder_landscape',
      check: (s) => {
        expect(s.x).toBeCloseTo(8, 1);
        expect(s.z).toBeCloseTo(8, 1);
      },
    },
    {
      kind: 'texture',
      name: 'placeholder_texture',
      check: (s) => {
        expect(s.x).toBeCloseTo(2, 1);
        expect(s.y).toBeCloseTo(2, 1);
      },
    },
  ];
  for (const p of placeholders) {
    test(`@req-000-11 A new ${p.kind} placeholder appears in the viewport at metre scale`, async ({ page }) => {
      await page.selectOption('#kind', p.kind);
      await page.click('#new');
      const obj = await studioObject(page);
      expect(obj?.name).toBe(p.name);
      expect(obj?.kind).toBe(p.kind);
      if (obj) p.check(obj.size);
      await expect(page.locator('#status')).toContainText(`new ${p.kind} placeholder`);
    });
  }

  test('@req-000-12 Save exports the placeholder and the asset comes back from the list', async ({ page }) => {
    await page.selectOption('#kind', 'creature');
    await page.click('#new');
    await page.fill('#name', 'moss_boar');
    await page.fill('#wowdRef', 'moss_boar');
    await page.click('#save');
    await expect(page.locator('#status')).toHaveText('saved moss_boar');

    const row = page.locator('#assetList li', { hasText: 'moss_boar' });
    await expect(row.locator('.kind')).toHaveText('creature');
    await expect(row.locator('.ref')).toContainText('moss_boar');
    const savedId = await activeId(page);
    expect(savedId).not.toBeNull();

    // A fresh placeholder forgets the saved asset...
    await page.click('#new');
    expect(await activeId(page)).toBeNull();

    // ...and clicking the row brings it back into the viewport with its fields.
    await row.locator('div').first().click();
    await expect.poll(() => activeId(page)).toBe(savedId);
    await expect(page.locator('#status')).toHaveText('loaded moss_boar');
    expect(await studioObject(page)).not.toBeNull();
    await expect(page.locator('#name')).toHaveValue('moss_boar');
    await expect(page.locator('#wowdRef')).toHaveValue('moss_boar');
    await expect(row).toHaveClass(/active/);
  });

  test('@req-000-12 A texture is saved as a PNG', async ({ page, request }) => {
    await page.selectOption('#kind', 'texture');
    await page.click('#new');
    await page.fill('#name', 'bark_diffuse');
    await page.click('#save');
    await expect(page.locator('#status')).toHaveText('saved bark_diffuse');

    const assets = (await (await request.get('/api/assets')).json()) as Array<{ name: string; format: string; kind: string }>;
    const bark = assets.find((a) => a.name === 'bark_diffuse');
    expect(bark).toMatchObject({ kind: 'texture', format: 'png' });
  });

  test('@req-000-13 In production the app and the API come from one origin', async ({ page, request, baseURL }) => {
    for (const path of ['/', '/some/unknown/route']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(await res.text(), path).toContain('Asset Studio');
    }

    const listRequest = page.waitForRequest((r) => r.url().includes('/api/assets'));
    await page.goto('/');
    expect((await listRequest).url().startsWith(baseURL ?? '')).toBe(true);
    expect(await page.evaluate(() => window.__studio?.apiBase)).toBe('');
  });
});

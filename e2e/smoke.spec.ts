import { expect, test, type Page } from '@playwright/test';

interface VehicleDebugState {
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Signed speed along the heading; negative while reversing. */
  forwardSpeed: number;
  steering: number;
}

interface DebugApi {
  getTick(): number;
  getElapsedSeconds(): number;
  isPaused(): boolean;
  togglePause(): void;
  getVehicle(): VehicleDebugState;
  getChunks(): { active: number; loadedTotal: number; unloadedTotal: number };
  getEconomy(): {
    cargo: Record<string, number>;
    storage: Record<string, number>;
    cargoTotal: number;
    storageTotal: number;
    interaction: { kind: string; label: string } | null;
  };
  teleport(x: number, y: number): void;
  queueControls(controls: Record<string, unknown>): void;
  isTouchControlsVisible(): boolean;
}

type DebugWindow = Window & { __roadrage?: DebugApi };

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as DebugWindow).__roadrage));
}

function getVehicle(page: Page): Promise<VehicleDebugState> {
  return page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    return api.getVehicle();
  });
}

function currentTick(page: Page): Promise<number> {
  return page.evaluate(() => (window as DebugWindow).__roadrage?.getTick() ?? 0);
}

test('renders the test range and advances the fixed-step simulation', async ({ page }) => {
  const errors = collectErrors(page);

  await page.goto('/');

  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.hud__title')).toHaveText('ROADRAGE');
  await expect(page.locator('.fatal-error')).toBeHidden();

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.width ?? 0).toBeGreaterThan(320);
  expect(canvasBox?.height ?? 0).toBeGreaterThan(240);

  await waitForGame(page);

  // SwiftShader can stall a frame for well over half a second, so poll instead
  // of assuming a fixed number of frames within a short window.
  await expect
    .poll(() => currentTick(page), { timeout: 20_000, intervals: [100, 250, 500, 1000] })
    .toBeGreaterThan(10);

  const tickBefore = await currentTick(page);
  await expect
    .poll(() => currentTick(page), { timeout: 20_000, intervals: [100, 250, 500, 1000] })
    .toBeGreaterThan(tickBefore);

  // Pause via keyboard, verify the tick freezes, then resume.
  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => (window as DebugWindow).__roadrage?.isPaused() ?? false))
    .toBe(true);
  await page.waitForTimeout(300);
  const pausedTick = await currentTick(page);
  await page.waitForTimeout(600);
  const pausedTickLater = await currentTick(page);
  expect(pausedTickLater).toBe(pausedTick);

  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => (window as DebugWindow).__roadrage?.isPaused() ?? true))
    .toBe(false);
  await expect
    .poll(() => currentTick(page), { timeout: 20_000, intervals: [100, 250, 500, 1000] })
    .toBeGreaterThan(pausedTick);

  // Capture a frame for manual visual inspection.
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: 'test-results/test-range.png' });

  expect(errors).toEqual([]);
});

test('drives with the keyboard and reports speed', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  await expect
    .poll(async () => (await getVehicle(page)).speed, { timeout: 20_000 })
    .toBeGreaterThan(1);

  const before = await getVehicle(page);
  await page.keyboard.down('ArrowRight');
  await expect
    .poll(async () => (await getVehicle(page)).heading, { timeout: 20_000 })
    .toBeLessThan(before.heading - 0.05);
  await page.keyboard.up('ArrowRight');

  await expect
    .poll(
      async () => Number((await page.locator('[data-field="speed"]').textContent()) ?? '0'),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  // S / ArrowDown brakes first and then engages reverse, so the car passes
  // through zero and keeps rolling backwards.
  await page.keyboard.down('ArrowDown');
  await expect
    .poll(async () => (await getVehicle(page)).forwardSpeed, { timeout: 20_000 })
    .toBeLessThan(-0.5);
  await page.keyboard.up('ArrowDown');

  // Releasing it restores automatic forward throttle.
  await expect
    .poll(async () => (await getVehicle(page)).forwardSpeed, { timeout: 20_000 })
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('reverses with X from a standstill', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  // The car spawns at rest facing +X, so holding reverse must move it -X.
  const start = await getVehicle(page);
  await page.keyboard.down('KeyX');
  await expect
    .poll(async () => (await getVehicle(page)).x, { timeout: 30_000 })
    .toBeLessThan(start.x - 1);
  await page.keyboard.up('KeyX');

  // Releasing reverse restores automatic forward throttle.
  await expect
    .poll(async () => (await getVehicle(page)).x, { timeout: 20_000 })
    .toBeGreaterThan(start.x - 4);

  expect(errors).toEqual([]);
});

test('streams chunks while auto-driving across the world', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  const chunks = () =>
    page.evaluate(() => {
      const api = (window as DebugWindow).__roadrage;
      if (!api) throw new Error('debug api missing');
      return api.getChunks();
    });

  const initial = await chunks();
  expect(initial.active).toBeGreaterThan(0);
  expect(initial.unloadedTotal).toBe(0);

  // The car has automatic throttle, so it drives +X on its own and must leave
  // its starting chunk neighbourhood.
  await expect
    .poll(async () => (await chunks()).loadedTotal, { timeout: 40_000, intervals: [250, 500, 1000] })
    .toBeGreaterThan(initial.active);

  const grown = await chunks();
  expect(grown.active).toBeLessThanOrEqual(49);
  await expect
    .poll(async () => (await chunks()).unloadedTotal, { timeout: 40_000, intervals: [250, 500, 1000] })
    .toBeGreaterThan(0);

  // The HUD reports live chunk counts and the current biome.
  await expect
    .poll(
      async () => Number((await page.locator('[data-field="chunks"]').textContent() ?? '0').split('/')[0] ?? 0),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test('harvests a starter node and unloads it at the depot', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  const economy = () =>
    page.evaluate(() => {
      const api = (window as DebugWindow).__roadrage;
      if (!api) throw new Error('debug api missing');
      return api.getEconomy();
    });

  // Park next to the handcrafted starter scrap node and hold E.
  await page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    api?.teleport(-19.5, -12.5);
  });

  await expect
    .poll(async () => (await economy()).interaction?.kind ?? null, { timeout: 20_000 })
    .toBe('harvest');

  await expect
    .poll(
      async () => (await page.locator('.hud__prompt').textContent()) ?? '',
      { timeout: 20_000 },
    )
    .toContain('ДОБЫТЬ');

  await page.keyboard.down('KeyE');
  await expect
    .poll(async () => (await economy()).cargoTotal, { timeout: 30_000 })
    .toBeGreaterThan(3);
  await page.keyboard.up('KeyE');

  const carried = (await economy()).cargoTotal;
  expect(carried).toBeGreaterThan(0);

  // The HUD cargo counter mirrors the simulation.
  await expect
    .poll(
      async () =>
        Number(
          ((await page.locator('[data-field="cargo"]').textContent()) ?? '0/0').split('/')[0],
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  // Drive onto the depot and unload.
  await page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    api?.teleport(10.2, 5.2);
  });
  await expect
    .poll(async () => (await economy()).interaction?.kind ?? null, { timeout: 20_000 })
    .toBe('deposit');

  await page.keyboard.down('KeyE');
  await expect
    .poll(async () => (await economy()).cargoTotal, { timeout: 30_000 })
    .toBe(0);
  await page.keyboard.up('KeyE');

  expect((await economy()).storageTotal).toBeGreaterThanOrEqual(carried);
  expect(errors).toEqual([]);
});

test('keeps the canvas sized after a mobile viewport resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.locator('.fatal-error')).toBeHidden();
  await waitForGame(page);

  const size = await page.locator('#game-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  });

  expect(size.width).toBeGreaterThan(300);
  expect(size.height).toBeGreaterThan(600);
});

test.describe('touch controls', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test('shows touch buttons and steers while held', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await waitForGame(page);

    await expect
      .poll(() => page.evaluate(() => (window as DebugWindow).__roadrage?.isTouchControlsVisible() ?? false))
      .toBe(true);

    const rightButton = page.locator('[data-control="right"]');
    await expect(rightButton).toBeVisible();
    await expect
      .poll(async () => (await getVehicle(page)).speed, { timeout: 20_000 })
      .toBeGreaterThan(1);

    const before = await getVehicle(page);
    const box = await rightButton.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error('touch button has no box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(rightButton).toHaveClass(/touch-controls__button--active/);
    await expect
      .poll(async () => (await getVehicle(page)).heading, { timeout: 20_000 })
      .toBeLessThan(before.heading - 0.05);
    await page.mouse.up();
    await expect(rightButton).not.toHaveClass(/touch-controls__button--active/);

    expect(errors).toEqual([]);
  });
});

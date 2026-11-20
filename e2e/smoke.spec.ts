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
  getBases(): {
    bases: { name: string; structures: number; storage: Record<string, number> }[];
    build: { action: string; label: string; affordable: boolean } | null;
  };
  getGarage(): {
    open: boolean;
    selectedSlot: number;
    slots: { slotId: string; moduleId: string | null }[];
    levels: Record<string, number>;
    stats: Record<string, number>;
  };
  grantCargo(amounts: Partial<Record<'scrap' | 'fuel' | 'water', number>>): void;
  openGarage(): void;
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

function garageState(page: Page): Promise<{
  open: boolean;
  selectedSlot: number;
  slots: { slotId: string; moduleId: string | null }[];
  levels: Record<string, number>;
  stats: Record<string, number>;
}> {
  return page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    return api.getGarage();
  });
}

function frameStats(page: Page): Promise<{
  fps: number;
  frameMs: number;
  simMs: number;
  renderMs: number;
  budgetRatio: number;
  droppedSeconds: number;
  samples: number;
}> {
  return page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    return api.getFrameStats();
  });
}

function renderStats(page: Page): Promise<{
  quality: string;
  activeProjectiles: number;
  activeEffects: number;
  pooledProjectiles: number;
  pooledEffects: number;
}> {
  return page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    return api.getRenderStats();
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
  // Braking then reversing needs simulated seconds; software rendering on a
  // busy host runs the sim far slower than real time.
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  await expect
    .poll(async () => (await getVehicle(page)).speed, {
      timeout: 60_000,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThan(1);

  const before = await getVehicle(page);
  await page.keyboard.down('ArrowRight');
  await expect
    .poll(async () => (await getVehicle(page)).heading, {
      timeout: 60_000,
      intervals: [250, 500, 1000],
    })
    .toBeLessThan(before.heading - 0.05);
  await page.keyboard.up('ArrowRight');

  await expect
    .poll(
      async () => Number((await page.locator('[data-field="speed"]').textContent()) ?? '0'),
      { timeout: 60_000, intervals: [250, 500, 1000] },
    )
    .toBeGreaterThan(0);

  // S / ArrowDown brakes first and then engages reverse, so the car passes
  // through zero and keeps rolling backwards.
  await page.keyboard.down('ArrowDown');
  await expect
    .poll(async () => (await getVehicle(page)).forwardSpeed, {
      timeout: 90_000,
      intervals: [250, 500, 1000],
    })
    .toBeLessThan(-0.5);
  await page.keyboard.up('ArrowDown');
  await expect
    .poll(async () => (await getVehicle(page)).forwardSpeed, {
      timeout: 60_000,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThan(-0.5);

  // Note: the "release restores auto-throttle" behaviour is covered by the
  // stepVehicle unit tests. Asserting it here would depend on wherever the car
  // happens to end up after turning and reversing — it can legitimately rest
  // against a rock, where forward speed stays near zero.

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
  // Crossing several chunks takes many simulated seconds, and software WebGL
  // on a loaded host can be several times slower than real time.
  test.setTimeout(180_000);
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
  // its starting chunk neighbourhood. Unloading only happens once it is a few
  // chunks away, which is many simulated seconds on software WebGL.
  await expect
    .poll(async () => (await chunks()).loadedTotal, {
      timeout: 120_000,
      intervals: [500, 1000],
    })
    .toBeGreaterThan(initial.active);

  const grown = await chunks();
  expect(grown.active).toBeLessThanOrEqual(49);
  await expect
    .poll(async () => (await chunks()).unloadedTotal, {
      timeout: 120_000,
      intervals: [500, 1000],
    })
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
  test.setTimeout(150_000);
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

test('builds a structure on the starter base from harvested scrap', async ({ page }) => {
  // Harvesting is rate-limited in simulated time, which is slow under
  // software rendering.
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  const bases = () =>
    page.evaluate(() => {
      const api = (window as DebugWindow).__roadrage;
      if (!api) throw new Error('debug api missing');
      return api.getBases();
    });

  const initial = await bases();
  expect(initial.bases).toHaveLength(1);
  expect(initial.bases[0]?.structures).toBe(0);

  // Harvest the starter node. The car auto-drives, so pin it to the node on
  // every poll and wait for enough scrap instead of a fixed number of tries.
  await page.keyboard.down('KeyE');
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          (window as DebugWindow).__roadrage?.teleport(-19.5, -12.5);
        });
        return page.evaluate(() => {
          const api = (window as DebugWindow).__roadrage;
          if (!api) throw new Error('debug api missing');
          return api.getEconomy().cargo.scrap ?? 0;
        });
      },
      { timeout: 150_000, intervals: [400, 800] },
    )
    .toBeGreaterThanOrEqual(20);
  await page.keyboard.up('KeyE');

  // Build on the pad: press V and confirm the base prompt was actionable.
  await page.evaluate(() => {
    (window as DebugWindow).__roadrage?.teleport(10.2, 5.2);
  });
  await expect
    .poll(async () => (await bases()).build?.action ?? null, {
      timeout: 60_000,
      intervals: [500, 1000],
    })
    .toBe('build');

  await page.keyboard.press('KeyV');

  await expect
    .poll(async () => (await bases()).bases[0]?.structures ?? 0, {
      timeout: 60_000,
      intervals: [500, 1000],
    })
    .toBe(1);

  // The HUD base counter follows the simulation.
  await expect
    .poll(
      async () =>
        (await page.locator('.hud__bases-line').first().textContent()) ?? '',
      { timeout: 20_000 },
    )
    .toContain('1');

  expect(errors).toEqual([]);
});

test('opens the garage, fits armour and upgrades the engine', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  const garage = () =>
    page.evaluate(() => {
      const api = (window as DebugWindow).__roadrage;
      if (!api) throw new Error('debug api missing');
      return api.getGarage();
    });

  // Give the car a workshop and funds, then brake so it stays in reach while
  // the queued keyboard actions are applied on subsequent ticks.
  await page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    api.grantCargo({ scrap: 300, fuel: 100, water: 100 });
    api.openGarage();
    api.queueControls({ brake: 1 });
  });

  await expect
    .poll(async () => (await garage()).open, { timeout: 30_000, intervals: [250, 500] })
    .toBe(true);
  await expect(page.locator('.hud__garage')).toBeVisible();
  await expect(page.locator('.hud__garage')).toContainText('ГАРАЖ');

  // Digit3 selects the first utility bay; G fits the cheapest available module.
  await page.keyboard.press('Digit3');
  await expect
    .poll(async () => (await garage()).selectedSlot, { timeout: 20_000 })
    .toBe(2);
  await page.keyboard.press('KeyG');
  await expect
    .poll(async () => (await garage()).slots[2]?.moduleId, { timeout: 20_000 })
    .toBe('reinforced-plating');
  await expect
    .poll(async () => (await garage()).stats.armor, { timeout: 20_000 })
    .toBe(45);
  await expect(page.locator('.hud__garage-options')).toContainText('БРОН');

  // N buys the next engine level; the derived top speed must follow.
  const speedBefore = (await garage()).stats.maxForwardSpeed ?? 0;
  await page.keyboard.press('KeyN');
  await expect
    .poll(async () => (await garage()).levels.engine, { timeout: 20_000 })
    .toBe(1);
  await expect
    .poll(async () => (await garage()).stats.maxForwardSpeed, { timeout: 20_000 })
    .toBeGreaterThan(speedBefore);

  expect(errors).toEqual([]);
});

test('saves through the menu and restores the run after a reload', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  // Build a small but meaningful state: a workshop, fitted armour and the
  // matching garage stat, so loading proves more than just the tick counter.
  await page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    api.grantCargo({ scrap: 300, fuel: 100, water: 100 });
    api.openGarage();
    api.queueControls({ brake: 1 });
  });
  await expect
    .poll(async () => (await garageState(page)).open, { timeout: 30_000 })
    .toBe(true);
  await page.keyboard.press('Digit3');
  await page.keyboard.press('KeyG');
  await expect
    .poll(async () => (await garageState(page)).stats.armor, { timeout: 30_000 })
    .toBe(45);

  await expect
    .poll(() => currentTick(page), { timeout: 30_000 })
    .toBeGreaterThan(10);

  // Save from the UI, not the debug API: this exercises the menu wiring.
  await page.locator('.menu__toggle').click();
  await expect(page.locator('.menu')).toBeVisible();
  await page.locator('.menu__slot[data-slot="1"] [data-menu-action="save"]').click();
  await expect(page.locator('.menu__foot [data-field="status"]')).toContainText('СОХРАНЕНО');

  const savedTick = await currentTick(page);
  const savedArmor = (await garageState(page)).stats.armor;
  expect(savedArmor).toBe(45);

  // A reload must not depend on in-memory state: the slot lives in IndexedDB.
  await page.reload();
  await waitForGame(page);
  await expect
    .poll(() => currentTick(page), { timeout: 30_000 })
    .toBeGreaterThan(5);
  expect(await currentTick(page)).toBeLessThan(savedTick);

  await page.locator('.menu__toggle').click();
  await expect(page.locator('.menu')).toBeVisible();
  await expect(page.locator('.menu__slot[data-slot="1"]')).toContainText('тик');
  await page.locator('.menu__slot[data-slot="1"] [data-menu-action="load"]').click();
  await expect(page.locator('.menu__foot [data-field="status"]')).toContainText('ЗАГРУЖЕНО');

  // The menu pauses the game, so the restored tick stays exact while we read it.
  expect(await currentTick(page)).toBe(savedTick);
  expect((await garageState(page)).stats.armor).toBe(savedArmor);

  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toBeHidden();
  await expect
    .poll(() => currentTick(page), { timeout: 30_000 })
    .toBeGreaterThan(savedTick);

  expect(errors).toEqual([]);
});

test('reports frame budgets, reuses transient meshes and persists graphics quality', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForGame(page);

  await expect
    .poll(async () => (await frameStats(page)).samples, { timeout: 30_000 })
    .toBeGreaterThan(5);
  const budget = await frameStats(page);
  expect(budget.frameMs).toBeGreaterThan(0);
  expect(budget.fps).toBeGreaterThan(0);
  expect(Number.isFinite(budget.budgetRatio)).toBe(true);
  expect(budget.droppedSeconds).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.hud__row--budget [data-field="frame-budget"]')).not.toHaveText('--');
  await expect(page.locator('.hud__row--budget [data-field="dropped"]')).toContainText('с');

  // Fire for a while, then let the projectiles expire: the renderer should
  // park their meshes in a pool instead of allocating a new one every shot.
  await page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    api.queueAimControls({ fire: true });
  });
  await expect
    .poll(async () => (await renderStats(page)).activeProjectiles, { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const api = (window as DebugWindow).__roadrage;
    if (!api) throw new Error('debug api missing');
    api.queueAimControls({ fire: false });
  });
  await expect
    .poll(
      async () => {
        const stats = await renderStats(page);
        return stats.pooledProjectiles + stats.pooledEffects;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await page.locator('.menu__toggle').click();
  await expect(page.locator('.menu')).toBeVisible();
  await page.locator('[data-tab="settings"]').click();
  await expect(page.locator('[data-panel="settings"]')).toBeVisible();
  await page.locator('.menu__quality [data-quality="low"]').click();
  await expect(page.locator('.menu__foot [data-field="status"]')).toContainText('ЭКОНОМ');
  expect((await renderStats(page)).quality).toBe('low');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toBeHidden();

  await page.reload();
  await waitForGame(page);
  expect((await renderStats(page)).quality).toBe('low');

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


  test('uses garage and slot buttons without a keyboard', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await waitForGame(page);

    await page.evaluate(() => {
      const api = (window as DebugWindow).__roadrage!;
      api.openGarage();
      api.grantCargo({ scrap: 100 });
    });
    await expect.poll(() => page.evaluate(() => (window as DebugWindow).__roadrage!.getGarage().open)).toBe(true);
    await expect(page.locator('[data-action="garage-workshop"]')).toBeVisible();

    await page.locator('[data-action="garage-workshop"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as DebugWindow).__roadrage!.getGarage().levels.workshop ?? 0))
      .toBe(1);

    await page.locator('[data-action="slot-2"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as DebugWindow).__roadrage!.getGarage().selectedSlot))
      .toBe(1);
    expect(errors).toEqual([]);
  });

  test('opens the settings menu on a mobile viewport', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await waitForGame(page);

    await page.locator('.menu__toggle').click();
    await expect(page.locator('.menu')).toBeVisible();
    await page.locator('[data-tab="settings"]').click();
    await expect(page.locator('[data-panel="settings"]')).toBeVisible();
    await page.locator('.menu__quality [data-quality="high"]').click();
    await expect(page.locator('.menu__foot [data-field="status"]')).toContainText('ЧЁТКО');
    expect((await renderStats(page)).quality).toBe('high');
    expect(await page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(390);

    await page.keyboard.press('Escape');
    await expect(page.locator('.menu')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

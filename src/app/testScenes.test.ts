import { describe, expect, it } from 'vitest';
import { Vec2 } from '../core/math/Vec2';
import { ENEMY_DEFINITIONS } from '../data/enemies';
import { GAME_CONFIG } from '../data/gameplay';
import { validateSerializedGameState } from '../save/validateSave';
import type { SerializedGameState } from '../sim/persistence/SerializedGameState';
import { Simulation } from '../sim/Simulation';
import {
  ALL_TEST_SCENES,
  getTestScene,
  TEST_SCENE_IDS,
  type Mutable,
  type TestSceneId,
} from './testScenes';

/** Stationary turrets must not be able to fire at a prepared base pad. */
const SAFE_BASE_RADIUS = 26;

function basePad(config: {
  readonly props: readonly { readonly kind: string; readonly x: number; readonly y: number }[];
}): { x: number; y: number } | null {
  const pad = config.props.find((prop) => prop.kind === 'pad');
  return pad ? { x: pad.x, y: pad.y } : null;
}

function prepareScene(id: TestSceneId) {
  const scene = getTestScene(id);
  if (!scene) throw new Error(`missing scene ${id}`);
  const setup = new Simulation(scene.config);
  const state = setup.exportState();
  scene.prepare(state as Mutable<SerializedGameState>);
  expect(validateSerializedGameState(state)).toEqual([]);
  setup.importState(state);
  return { scene, simulation: setup, initial: setup.exportState() };
}

describe('manual test scenes', () => {
  it('resolves every advertised scene and rejects unknown ids', () => {
    expect(TEST_SCENE_IDS).toHaveLength(5);
    expect(ALL_TEST_SCENES.map((entry) => entry.id)).toEqual(TEST_SCENE_IDS);
    for (const scene of ALL_TEST_SCENES) {
      expect(scene.summary.length).toBeGreaterThan(0);
    }
    for (const id of TEST_SCENE_IDS) {
      const scene = getTestScene(id);
      expect(scene?.id).toBe(id);
      expect(scene?.guide.goal.length).toBeGreaterThan(0);
      expect(scene?.guide.mechanics.length).toBeGreaterThan(0);
      expect(scene?.guide.start.length).toBeGreaterThan(0);
      expect(scene?.guide.steps.length).toBeGreaterThan(0);
      expect(scene?.guide.expected.length).toBeGreaterThan(0);
      expect(scene?.guide.notCovered.length).toBeGreaterThan(0);
    }
    expect(getTestScene('missing')).toBeNull();
    expect(getTestScene(null)).toBeNull();
  });

  it.each(TEST_SCENE_IDS)('prepares a valid, running state for %s', (id) => {
    const { simulation, scene } = prepareScene(id);
    simulation.stepMany(240);

    const state = simulation.snapshot();
    expect(scene.title.length).toBeGreaterThan(0);
    expect(Number.isFinite(state.vehicle.x)).toBe(true);
    expect(Number.isFinite(state.vehicle.y)).toBe(true);
    expect(simulation.time.tick).toBe(240);

    if (id === 'driving') {
      expect(simulation.world.enemies).toHaveLength(0);
      expect(simulation.world.bases[0]?.structures).toHaveLength(0);
    }
    if (id === 'combat') {
      expect(simulation.world.enemies).toHaveLength(3);
    }
    if (id === 'base') {
      expect(simulation.world.economy.cargo.scrap).toBeGreaterThan(0);
      expect(simulation.world.bases[0]?.structures).toHaveLength(2);
      const nodeIds = simulation.world.resourceNodes.map((node) => node.id);
      expect(nodeIds).toEqual(expect.arrayContaining(['scene-scrap', 'scene-fuel', 'scene-water']));
    }
    if (id === 'raid') {
      expect(simulation.world.bases[0]?.structures).toHaveLength(4);
      expect(simulation.world.raids.length + simulation.world.raidReports.length).toBeGreaterThan(0);
    }
    if (id === 'tutorial') {
      expect(simulation.world.enemies).toHaveLength(1);
      expect(simulation.world.bases[0]?.structures).toHaveLength(1);
      expect(simulation.world.economy.cargo.scrap).toBeGreaterThan(0);
    }
  });

  it('keeps default stationary enemies away from the starter base pad', () => {
    const pad = basePad(GAME_CONFIG);
    expect(pad).not.toBeNull();
    for (const spawn of GAME_CONFIG.enemySpawns) {
      if (ENEMY_DEFINITIONS[spawn.kind].ai.behaviour !== 'stationary') continue;
      const distance = Math.hypot(spawn.x - (pad?.x ?? 0), spawn.y - (pad?.y ?? 0));
      expect(distance, spawn.id).toBeGreaterThan(SAFE_BASE_RADIUS);
    }
  });

  it.each(TEST_SCENE_IDS)('keeps stationary enemies away from the base in %s', (id) => {
    const scene = getTestScene(id);
    const pad = scene ? basePad(scene.config) : null;
    if (!scene || !pad) return;
    for (const spawn of scene.config.enemySpawns) {
      if (ENEMY_DEFINITIONS[spawn.kind].ai.behaviour !== 'stationary') continue;
      const distance = Math.hypot(spawn.x - pad.x, spawn.y - pad.y);
      expect(distance, `${id}:${spawn.id}`).toBeGreaterThan(SAFE_BASE_RADIUS);
    }
  });

  it('tutorial can be completed through harvest, build, install and unload', () => {
    const { simulation } = prepareScene('tutorial');
    const world = simulation.world;

    const scrapNode = world.resourceNodes.find((node) => node.id === 'scene-scrap');
    expect(scrapNode).toBeDefined();
    world.vehicle = {
      ...world.vehicle,
      position: new Vec2(scrapNode?.x ?? 0, scrapNode?.y ?? 0),
      velocity: Vec2.ZERO,
    };
    simulation.queueControls({ interact: true, brake: 1 });
    simulation.stepMany(120);
    expect(world.economy.cargo.scrap).toBeGreaterThan(40);

    const base = world.bases[0];
    expect(base).toBeDefined();
    world.vehicle = {
      ...world.vehicle,
      position: new Vec2(base?.x ?? 0, base?.y ?? 0),
      velocity: Vec2.ZERO,
    };
    simulation.queueControls({ interact: false, brake: 1, buildToken: 1 });
    simulation.step();
    expect(base?.structures.some((structure) => structure.kind === 'workshop')).toBe(true);

    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.step();
    simulation.queueEquipmentAction({ kind: 'install' });
    simulation.step();
    expect(world.garage.slots[2]?.moduleId).not.toBeNull();

    const storageBefore =
      (base?.storage.scrap ?? 0) + (base?.storage.fuel ?? 0) + (base?.storage.water ?? 0);
    simulation.queueControls({ interact: true, brake: 1 });
    simulation.stepMany(120);
    const storageAfter =
      (base?.storage.scrap ?? 0) + (base?.storage.fuel ?? 0) + (base?.storage.water ?? 0);
    expect(storageAfter).toBeGreaterThan(storageBefore);
  });

  it('tutorial still builds and installs after the player unloads first', () => {
    const { simulation } = prepareScene('tutorial');
    const world = simulation.world;
    const base = world.bases[0];
    expect(base).toBeDefined();

    // Natural player flow: drive to the depot and empty the truck before
    // touching the build key. The base storage must pay for the work.
    world.vehicle = {
      ...world.vehicle,
      position: new Vec2(base?.x ?? 0, base?.y ?? 0),
      velocity: Vec2.ZERO,
    };
    simulation.queueControls({ interact: true, brake: 1 });
    simulation.stepMany(150);
    expect(world.economy.cargo.scrap).toBe(0);
    expect(world.economy.cargo.fuel).toBe(0);
    expect(world.economy.cargo.water).toBe(0);

    const storageBefore =
      (base?.storage.scrap ?? 0) + (base?.storage.fuel ?? 0) + (base?.storage.water ?? 0);
    simulation.queueControls({ interact: false, brake: 1, buildToken: 1 });
    simulation.step();
    expect(base?.structures.some((structure) => structure.kind === 'workshop')).toBe(true);

    simulation.queueEquipmentAction({ kind: 'select-slot', index: 2 });
    simulation.step();
    simulation.queueEquipmentAction({ kind: 'install' });
    simulation.step();
    expect(world.garage.slots[2]?.moduleId).not.toBeNull();
    expect(world.garage.lastRefusal).toBeNull();
    const storageAfter =
      (base?.storage.scrap ?? 0) + (base?.storage.fuel ?? 0) + (base?.storage.water ?? 0);
    expect(storageAfter).toBeLessThan(storageBefore);
  });

  it.each(TEST_SCENE_IDS)('restarts %s to the exact opening state', (id) => {
    const { simulation, initial } = prepareScene(id);
    simulation.stepMany(120);

    simulation.importState(initial);
    expect(JSON.stringify(simulation.exportState())).toBe(JSON.stringify(initial));

    simulation.stepMany(120);
    const replay = simulation.exportState();
    simulation.importState(initial);
    simulation.stepMany(120);
    expect(JSON.stringify(simulation.exportState())).toBe(JSON.stringify(replay));
  });
});

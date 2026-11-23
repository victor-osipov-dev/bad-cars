import { describe, expect, it } from 'vitest';
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

import { describe, expect, it } from 'vitest';
import type { WorldSnapshot, WorldState } from '../sim/world/WorldState';
import { captureBaseline, TUTORIAL_STEPS, type TutorialContext } from './tutorialSteps';

type MutableSnapshot = {
  vehicle: { forwardSpeed: number; heading: number };
  economy: { cargoTotal: number; storageTotal: number };
  baseState: { bases: { structures: unknown[] }[] };
  combat: { enemies: { health: number }[] };
};

function context(overrides: Partial<TutorialContext> = {}): TutorialContext {
  const snapshot = {
    vehicle: { forwardSpeed: 0, heading: 0 },
    economy: { cargoTotal: 0, storageTotal: 0 },
    baseState: { bases: [{ structures: [] }] },
    combat: { enemies: [{ health: 60 }] },
  } as unknown as WorldSnapshot;
  const world = {
    garage: { slots: [{ moduleId: null }] },
  } as unknown as WorldState;
  return {
    driveEnabled: false,
    snapshot,
    world,
    ...overrides,
  };
}

function mutable(contextValue: TutorialContext): MutableSnapshot {
  return contextValue.snapshot as unknown as MutableSnapshot;
}

describe('tutorial steps', () => {
  it('has a short, ordered step list', () => {
    expect(TUTORIAL_STEPS).toHaveLength(8);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.text.length).toBeGreaterThan(0);
    }
  });

  it('starts only after the drive switch is enabled', () => {
    const stopped = context();
    const baseline = captureBaseline(stopped);
    expect(TUTORIAL_STEPS[0]?.done(stopped, baseline)).toBe(false);

    const driving = context({ driveEnabled: true });
    expect(TUTORIAL_STEPS[0]?.done(driving, baseline)).toBe(true);
  });

  it('combines acceleration and steering in one step', () => {
    const start = context();
    const baseline = captureBaseline(start);
    const state = mutable(start);
    state.vehicle.forwardSpeed = 6;
    expect(TUTORIAL_STEPS[1]?.done(start, baseline)).toBe(false);
    state.vehicle.heading = 0.5;
    expect(TUTORIAL_STEPS[1]?.done(start, baseline)).toBe(true);
  });

  it('detects harvesting, building and shooting against the baseline', () => {
    const start = context();
    const baseline = captureBaseline(start);
    const state = mutable(start);
    state.economy.cargoTotal = 10;
    state.baseState.bases[0]?.structures.push({ id: 'workshop' });
    state.combat.enemies[0]!.health = 20;

    expect(TUTORIAL_STEPS[3]?.done(start, baseline)).toBe(true);
    expect(TUTORIAL_STEPS[5]?.done(start, baseline)).toBe(true);
    expect(TUTORIAL_STEPS[7]?.done(start, baseline)).toBe(true);
  });
});

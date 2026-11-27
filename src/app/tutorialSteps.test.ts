import { describe, expect, it } from 'vitest';
import type { WorldSnapshot, WorldState } from '../sim/world/WorldState';
import {
  captureBaseline,
  TUTORIAL_PHASES,
  TUTORIAL_STEPS,
  type TutorialContext,
} from './tutorialSteps';

type MutableSnapshot = {
  vehicle: { forwardSpeed: number; heading: number };
  economy: { cargoTotal: number; storageTotal: number };
  baseState: { bases: { structures: { kind: string }[] }[] };
  combat: { enemies: { health: number; alive: boolean }[] };
};

type MutableWorld = {
  garage: { selectedSlot: number; slots: { moduleId: string | null }[] };
};

function context(overrides: Partial<TutorialContext> = {}): TutorialContext {
  const snapshot = {
    vehicle: { forwardSpeed: 0, heading: 0 },
    economy: { cargoTotal: 0, storageTotal: 0 },
    baseState: { bases: [{ structures: [] }] },
    combat: { enemies: [{ health: 60, alive: true }] },
  } as unknown as WorldSnapshot;
  const world = {
    garage: {
      selectedSlot: 0,
      slots: [{ moduleId: null }, { moduleId: null }, { moduleId: null }],
    },
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

function mutableWorld(contextValue: TutorialContext): MutableWorld {
  return contextValue.world as unknown as MutableWorld;
}

describe('tutorial steps', () => {
  it('has a short, ordered step list grouped into phases', () => {
    expect(TUTORIAL_STEPS).toHaveLength(9);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.hint.length).toBeGreaterThan(0);
      expect(step.key.length).toBeGreaterThan(0);
      expect(step.key.length).toBeLessThanOrEqual(6);
    }

    expect(TUTORIAL_PHASES.map((phase) => phase.id)).toEqual([
      'drive',
      'harvest',
      'base',
      'combat',
    ]);
    const phaseOrder = TUTORIAL_PHASES.map((phase) => phase.id);
    let previous = 0;
    for (const step of TUTORIAL_STEPS) {
      const index = phaseOrder.indexOf(step.phase);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    for (const phase of TUTORIAL_PHASES) {
      expect(phase.goal.length).toBeGreaterThan(0);
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

  it('detects reverse gear', () => {
    const start = context();
    const baseline = captureBaseline(start);
    mutable(start).vehicle.forwardSpeed = -1;
    expect(TUTORIAL_STEPS[2]?.done(start, baseline)).toBe(true);
  });

  it('accepts a workshop, selected bay and module completed before the step starts', () => {
    const start = context();
    mutable(start).baseState.bases[0]?.structures.push({ kind: 'workshop' });
    mutableWorld(start).garage.selectedSlot = 2;
    mutableWorld(start).garage.slots[2]!.moduleId = 'utility-cargo';
    const baseline = captureBaseline(start);

    expect(TUTORIAL_STEPS[4]?.done(start, baseline)).toBe(true);
    expect(TUTORIAL_STEPS[5]?.done(start, baseline)).toBe(true);
    expect(TUTORIAL_STEPS[6]?.done(start, baseline)).toBe(true);
  });

  it('asks for slot 3 before installing the module', () => {
    const start = context();
    const baseline = captureBaseline(start);
    expect(TUTORIAL_STEPS[5]?.done(start, baseline)).toBe(false);

    mutableWorld(start).garage.selectedSlot = 2;
    expect(TUTORIAL_STEPS[5]?.done(start, baseline)).toBe(true);
    expect(TUTORIAL_STEPS[6]?.done(start, baseline)).toBe(false);

    mutableWorld(start).garage.slots[2]!.moduleId = 'utility-cargo';
    expect(TUTORIAL_STEPS[6]?.done(start, baseline)).toBe(true);
  });

  it('detects harvest, build, module, unload and shooting', () => {
    const start = context();
    const baseline = captureBaseline(start);
    const state = mutable(start);
    state.economy.cargoTotal = 20;
    expect(TUTORIAL_STEPS[3]?.done(start, baseline)).toBe(true);
    state.baseState.bases[0]?.structures.push({ kind: 'workshop' });
    expect(TUTORIAL_STEPS[4]?.done(start, baseline)).toBe(true);
    mutableWorld(start).garage.selectedSlot = 2;
    expect(TUTORIAL_STEPS[5]?.done(start, baseline)).toBe(true);
    mutableWorld(start).garage.slots[2]!.moduleId = 'utility-cargo';
    expect(TUTORIAL_STEPS[6]?.done(start, baseline)).toBe(true);
    state.economy.storageTotal = 5;
    expect(TUTORIAL_STEPS[7]?.done(start, baseline)).toBe(true);
    state.combat.enemies[0]!.health = 20;
    expect(TUTORIAL_STEPS[8]?.done(start, baseline)).toBe(true);
  });
});

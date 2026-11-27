import type { WorldSnapshot, WorldState } from '../sim/world/WorldState';

/** Four stages of the player's core loop, shown as a rail in the tutorial. */
export type TutorialPhase = 'drive' | 'harvest' | 'base' | 'combat';

export interface TutorialPhaseDefinition {
  readonly id: TutorialPhase;
  readonly label: string;
  /** One-line goal for the phase, not the individual step. */
  readonly goal: string;
}

export const TUTORIAL_PHASES: readonly TutorialPhaseDefinition[] = [
  { id: 'drive', label: 'ДВИЖЕНИЕ', goal: 'Научись управлять машиной' },
  { id: 'harvest', label: 'ДОБЫЧА', goal: 'Добудь ресурсы' },
  { id: 'base', label: 'БАЗА', goal: 'Построй базу и улучши машину' },
  { id: 'combat', label: 'БОЙ', goal: 'Защитись от врагов' },
];

export interface TutorialBaseline {
  readonly heading: number;
  readonly cargoTotal: number;
  readonly storageTotal: number;
  readonly structures: number;
  readonly enemyHealth: number;
  readonly modules: number;
}

export interface TutorialContext {
  readonly driveEnabled: boolean;
  readonly snapshot: WorldSnapshot;
  readonly world: WorldState;
}

export interface TutorialStep {
  readonly phase: TutorialPhase;
  /** Imperative action, printed large. */
  readonly title: string;
  /** One short line explaining where or how. */
  readonly hint: string;
  /** Big key chip: the single control the step expects. */
  readonly key: string;
  /** Garage bay to highlight while this step is active. */
  readonly highlightSlot?: number;
  readonly done: (context: TutorialContext, baseline: TutorialBaseline) => boolean;
}

function angleDelta(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function enemyHealth(snapshot: WorldSnapshot): number {
  return snapshot.combat.enemies.reduce((total, enemy) => total + enemy.health, 0);
}

/**
 * One action per step, ordered as the real game loop:
 * drive → harvest → build and upgrade → unload → fight.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    phase: 'drive',
    title: 'ЗАВЕДИ МАШИНУ',
    hint: 'Нажми W или кнопку «ДВИЖЕНИЕ»',
    key: 'W',
    done: (context) => context.driveEnabled,
  },
  {
    phase: 'drive',
    title: 'РАЗГОНИСЬ И ПОВЕРНИ',
    hint: 'Поворачивай на ходу',
    key: 'A / D',
    done: (context, baseline) =>
      Math.abs(context.snapshot.vehicle.forwardSpeed) > 4 &&
      angleDelta(context.snapshot.vehicle.heading, baseline.heading) > 0.25,
  },
  {
    phase: 'drive',
    title: 'СДАЙ НАЗАД',
    hint: 'Останови машину и удерживай',
    key: 'S',
    done: (context) => context.snapshot.vehicle.forwardSpeed < -0.8,
  },
  {
    phase: 'harvest',
    title: 'ДОБУДЬ МЕТАЛЛОЛОМ',
    hint: 'Подъедь к куче и удерживай',
    key: 'E',
    // One full load is not needed, but a handful of units must be mined so the
    // next step (workshop + module) stays affordable in any play order.
    done: (context, baseline) =>
      context.snapshot.economy.cargoTotal >= baseline.cargoTotal + 20,
  },
  {
    phase: 'base',
    title: 'ПОСТРОЙ МАСТЕРСКУЮ',
    hint: 'На базе нажми V — склад тоже идёт в дело',
    key: 'V',
    done: (context) =>
      (context.snapshot.baseState.bases[0]?.structures ?? []).some(
        (structure) => structure.kind === 'workshop',
      ),
  },
  {
    phase: 'base',
    title: 'ВЫБЕРИ СЛОТ 3',
    hint: 'Нажми 3 или кнопку МОД1',
    key: '3',
    highlightSlot: 2,
    done: (context) => context.world.garage.selectedSlot === 2,
  },
  {
    phase: 'base',
    title: 'ПОСТАВЬ БРОНЮ',
    hint: 'Модуль — деталь машины. Жми G или СТАВИТЬ',
    key: 'G',
    highlightSlot: 2,
    done: (context) =>
      context.world.garage.slots
        .slice(2)
        .some((slot) => slot.moduleId !== null),
  },
  {
    phase: 'base',
    title: 'РАЗГРУЗИ ОСТАТОК',
    hint: 'На складе удерживай',
    key: 'E',
    done: (context, baseline) =>
      context.snapshot.economy.cargoTotal === 0 ||
      context.snapshot.economy.storageTotal > baseline.storageTotal,
  },
  {
    phase: 'combat',
    title: 'СБЕЙ ТУРЕЛЬ',
    hint: 'Турель справа от базы — доезжай и держи',
    key: 'ЛКМ',
    done: (context, baseline) =>
      enemyHealth(context.snapshot) < baseline.enemyHealth ||
      context.snapshot.combat.enemies.some((enemy) => !enemy.alive),
  },
];

export function captureBaseline(context: TutorialContext): TutorialBaseline {
  return {
    heading: context.snapshot.vehicle.heading,
    cargoTotal: context.snapshot.economy.cargoTotal,
    storageTotal: context.snapshot.economy.storageTotal,
    structures: context.snapshot.baseState.bases[0]?.structures.length ?? 0,
    enemyHealth: enemyHealth(context.snapshot),
    modules: context.world.garage.slots.filter((slot) => slot.moduleId !== null).length,
  };
}

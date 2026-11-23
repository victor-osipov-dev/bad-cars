import type { WorldSnapshot, WorldState } from '../sim/world/WorldState';

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
  readonly title: string;
  readonly text: string;
  readonly done: (context: TutorialContext, baseline: TutorialBaseline) => boolean;
}

function angleDelta(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function enemyHealth(snapshot: WorldSnapshot): number {
  return snapshot.combat.enemies.reduce((total, enemy) => total + enemy.health, 0);
}

/** One short action per step; progress is detected from ordinary game state. */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    title: 'ВКЛЮЧИ ДВИЖЕНИЕ',
    text: 'Нажми W или кнопку «ДВИЖЕНИЕ» слева сверху.',
    done: (context) => context.driveEnabled,
  },
  {
    title: 'РАЗГОНИСЬ И ПОВЕРНИ',
    text: 'Разгонись и нажми A или D.',
    done: (context, baseline) =>
      Math.abs(context.snapshot.vehicle.forwardSpeed) > 4 &&
      angleDelta(context.snapshot.vehicle.heading, baseline.heading) > 0.25,
  },
  {
    title: 'ПОЕХАТЬ НАЗАД',
    text: 'Нажми X или S.',
    done: (context) => context.snapshot.vehicle.forwardSpeed < -0.8,
  },
  {
    title: 'ДОБУДЬ РЕСУРС',
    text: 'Подъедь к узлу, удерживай E.',
    done: (context, baseline) => context.snapshot.economy.cargoTotal > baseline.cargoTotal,
  },
  {
    title: 'СДАЙ ГРУЗ',
    text: 'Вернись на базу, нажми E.',
    done: (context, baseline) => context.snapshot.economy.storageTotal > baseline.storageTotal,
  },
  {
    title: 'ПОСТРОЙ МАСТЕРСКУЮ',
    text: 'У базы нажми V.',
    done: (context, baseline) =>
      (context.snapshot.baseState.bases[0]?.structures.length ?? 0) > baseline.structures,
  },
  {
    title: 'УСТАНОВИ МОДУЛЬ',
    text: 'В гараже выбери слот 3 и нажми G.',
    done: (context, baseline) =>
      context.world.garage.slots.filter((slot) => slot.moduleId !== null).length > baseline.modules,
  },
  {
    title: 'ПОСТРЕЛЯЙ ПО ЦЕЛИ',
    text: 'Наведись на мишень и стреляй ЛКМ.',
    done: (context, baseline) => enemyHealth(context.snapshot) < baseline.enemyHealth,
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

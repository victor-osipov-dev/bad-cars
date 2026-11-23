/**
 * Isolated scenes for manual testing.
 *
 * A scene is only data: a `GameplayConfig` plus a patch to a freshly exported
 * (and therefore valid) save state. All mechanics still run through the real
 * Simulation and its systems — no alternate implementations live here.
 */

import { BASE_SLOTS, type StructureKind } from '../data/bases';
import { ECONOMY_CONFIG } from '../data/economy';
import type { EnemySpawn } from '../data/enemies';
import {
  GAME_CONFIG,
  type GameplayConfig,
  type PropPlacement,
  type ResourceNodeSpawn,
} from '../data/gameplay';
import { RAID_CONFIG, type RaidConfig } from '../data/raids';
import { SCRAP_RUNNER } from '../data/vehicles';
import { DEFAULT_LOADOUT } from '../data/weapons';
import { createStructure } from '../sim/base/BaseState';
import type { SerializedGameState } from '../sim/persistence/SerializedGameState';

export type TestSceneId = 'driving' | 'combat' | 'base' | 'raid' | 'tutorial';

/** Save states are immutable by contract; fixtures need a mutable local view. */
export type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

/** In-game manual test card, shown in the collapsible scene guide. */
export interface SceneGuideData {
  readonly goal: string;
  readonly mechanics: string;
  readonly start: string;
  readonly steps: readonly string[];
  readonly expected: string;
  readonly notCovered: string;
}

export interface TestSceneDefinition {
  readonly id: TestSceneId;
  readonly title: string;
  /** One-line label for the in-game scene picker. */
  readonly summary: string;
  readonly config: GameplayConfig;
  readonly guide: SceneGuideData;
  /** Applies a fixture to a valid, freshly exported simulation state. */
  readonly prepare: (state: Mutable<SerializedGameState>) => void;
}

export const TEST_SCENE_IDS: readonly TestSceneId[] = [
  'driving',
  'combat',
  'base',
  'raid',
  'tutorial',
];

const prop = (
  id: string,
  kind: PropPlacement['kind'],
  x: number,
  y: number,
  scale = 1,
): PropPlacement => ({ id, kind, x, y, rotation: 0, scale });

/** Keeps the scene action close together and free of unrelated procedural props. */
const SCENE_WORLD = {
  ...GAME_CONFIG.world,
  halfWidth: 70,
  halfHeight: 70,
  spawnClearRadius: 40,
};

const NO_RAIDS: RaidConfig = {
  ...RAID_CONFIG,
  firstDelaySeconds: 1e9,
  baseIntervalSeconds: 1e9,
};

function sceneConfig(params: {
  readonly seedOffset: number;
  readonly props: readonly PropPlacement[];
  readonly spawn: { readonly x: number; readonly y: number; readonly headingRadians: number };
  readonly enemySpawns?: readonly EnemySpawn[];
  readonly spawnResourceNodes?: readonly ResourceNodeSpawn[];
  readonly raids?: RaidConfig;
}): GameplayConfig {
  return {
    ...GAME_CONFIG,
    worldSeed: GAME_CONFIG.worldSeed ^ params.seedOffset,
    world: SCENE_WORLD,
    props: params.props,
    vehicle: { ...SCRAP_RUNNER, spawn: params.spawn },
    loadout: DEFAULT_LOADOUT,
    enemySpawns: params.enemySpawns ?? [],
    spawnResourceNodes: params.spawnResourceNodes ?? [],
    raids: params.raids ?? NO_RAIDS,
  };
}

function patchVehicle(
  state: Mutable<SerializedGameState>,
  spawn: { readonly x: number; readonly y: number; readonly headingRadians: number },
): void {
  state.vehicle.x = spawn.x;
  state.vehicle.y = spawn.y;
  state.vehicle.heading = spawn.headingRadians;
  state.vehicle.steering = 0;
  state.vehicle.vx = 0;
  state.vehicle.vy = 0;
}

function setStructures(state: Mutable<SerializedGameState>, kinds: readonly StructureKind[]): void {
  const base = state.bases.items[0];
  if (!base) return;
  kinds.forEach((kind, index) => {
    const slot = BASE_SLOTS[index] ?? { x: 0, y: 0 };
    base.structures.push(
      createStructure({
        id: `scene-${kind}-${index}`,
        kind,
        x: base.x + slot.x,
        y: base.y + slot.y,
        slotIndex: index,
        builtTick: 0,
        maxCondition: ECONOMY_CONFIG.maxCondition,
      }),
    );
  });
}

const DRIVING_SPAWN = { x: -24, y: 0, headingRadians: 0 };

const DRIVING: TestSceneDefinition = {
  id: 'driving',
  title: 'СЦЕНА: УПРАВЛЕНИЕ И СТОЛКНОВЕНИЯ',
  summary: 'Управление, отскок от препятствий',
  guide: {
    goal: 'Проверить физику машины и управление без боя, экономики и рейдов.',
    mechanics: 'Газ, руль, тормоз/задний ход, дрифт, границы мира, отскок от препятствия и выход из него.',
    start: 'Машина на (-24, 0) носом на восток. Впереди камень, дальше ещё камни, обломок и ящики. Врагов нет, рейды отключены, база в дальнем углу, груз пуст.',
    steps: [
      'Проехать прямо до первого камня, не поворачивая.',
      'Сразу после удара продолжать держать газ и попробовать A / D.',
      'Остановиться (S), включить задний ход (X), сделать разворот с Shift.',
    ],
    expected: 'После удара машина заметно откатывается назад (около 1.5–2 м), затем примерно за 0.35 с тормозит откат и снова разгоняется вперёд. Руль работает и во время отката, задний ход и дрифт не ломают ориентацию.',
    notCovered: 'Стрельба, добыча, постройка, базы, рейды, сохранения.',
  },
  config: sceneConfig({
    seedOffset: 0x01,
    spawn: DRIVING_SPAWN,
    props: [
      prop('scene-pad', 'pad', 50, 50),
      prop('scene-rock-a', 'rock', -6, 0, 1.2),
      prop('scene-rock-b', 'rock', 9, 3, 1),
      prop('scene-rock-c', 'rock', 20, -5, 1.4),
      prop('scene-wreck', 'wreck', 32, -12),
      prop('scene-crate-a', 'crate', 2, -7),
      prop('scene-crate-b', 'crate', -2, 7),
    ],
  }),
  prepare: (state) => patchVehicle(state, DRIVING_SPAWN),
};

const COMBAT_SPAWN = { x: -16, y: 0, headingRadians: 0 };

const COMBAT: TestSceneDefinition = {
  id: 'combat',
  title: 'СЦЕНА: БОЙ И УКРЫТИЯ',
  summary: 'Оружие, укрытия, урон',
  guide: {
    goal: 'Проверить бой в чистом виде, не задействуя добычу и базу.',
    mechanics: 'Слоты 1 / 2, прицеливание мышью, удержание ЛКМ, перезарядка R, урон врагам, разрушение ящиков-укрытий, ответный огонь и прочность машины.',
    start: 'Машина на (-16, 0), три стационарные цели впереди (две лёгкие, одна тяжёлая), ящики как укрытия, полный боекомплект. Рейды и ресурсы отключены.',
    steps: [
      'Выстрелить из пулемёта по ближней цели, затем переключиться на пушку.',
      'Стрелять по ящику, пока он не разрушится.',
      'Подъехать ближе к тяжёлой цели и дать ей отвечать, понаблюдать за корпусом.',
      'Перезарядить оружие (R).',
    ],
    expected: 'Попадания снимают здоровье целям, ящик разрушается, пушка наносит больше урона, но стреляет реже. Враги стреляют в машину, HUD показывает урон корпуса.',
    notCovered: 'Добыча, экономика, постройка, рейды, мобильные рейдеры.',
  },
  config: sceneConfig({
    seedOffset: 0x02,
    spawn: COMBAT_SPAWN,
    props: [
      prop('scene-pad', 'pad', 50, -50),
      prop('scene-cover-a', 'crate', -2, -2),
      prop('scene-cover-b', 'crate', 0, 2),
      prop('scene-cover-c', 'crate', 3, -3),
      prop('scene-rock', 'rock', -8, 9),
      prop('scene-wreck', 'wreck', 24, 4),
    ],
    enemySpawns: [
      { id: 'scene-dummy-near', kind: 'scrap-dummy', x: 12, y: 0, rotation: Math.PI },
      { id: 'scene-dummy-far', kind: 'scrap-dummy', x: 24, y: -8, rotation: Math.PI },
      { id: 'scene-heavy', kind: 'heavy-dummy', x: 20, y: 12, rotation: Math.PI },
    ],
  }),
  prepare: (state) => patchVehicle(state, COMBAT_SPAWN),
};

const BASE_SPAWN = { x: -12, y: -2, headingRadians: 0 };

const BASE: TestSceneDefinition = {
  id: 'base',
  title: 'СЦЕНА: ДОБЫЧА, БАЗА И ГАРАЖ',
  summary: 'Добыча, стройка, гараж',
  guide: {
    goal: 'Проверить весь цикл прогрессии на одной площадке.',
    mechanics: 'Добыча E у узлов, разгрузка E на складе, основание базы B, строительство V, выбор базы Tab, гараж G / H, улучшения N / M / , .',
    start: 'Машина на (-12, -2) с 240 металлолома в багажнике; рядом три узла (металл, топливо, вода); база со складом и мастерской, на складе ресурсы. Врагов и рейдов нет.',
    steps: [
      'Подъехать к каждому узлу и добыть ресурс (E).',
      'Вернуться на площадку базы и разгрузиться (E).',
      'Нажать B на подготовленной площадке и V для постройки сооружения.',
      'Остановиться у мастерской и открыть гараж; установить/снять модуль и купить улучшения.',
    ],
    expected: 'Ресурсы пополняются и складываются на складе базы, сооружение появляется на фиксированном слоте, гараж меняет характеристики машины и списывает ресурсы, Tab переключает базу.',
    notCovered: 'Бой, рейды, разрушение укрытий, удалённая симуляция баз.',
  },
  config: sceneConfig({
    seedOffset: 0x03,
    spawn: BASE_SPAWN,
    props: [
      prop('scene-pad', 'pad', 6, 4),
      prop('scene-rock-a', 'rock', -22, 9),
      prop('scene-rock-b', 'rock', 22, 12),
      prop('scene-wreck', 'wreck', 24, -10),
    ],
    spawnResourceNodes: [
      { id: 'scene-scrap', kind: 'scrap', x: -8, y: -8 },
      { id: 'scene-fuel', kind: 'fuel', x: -2, y: 10 },
      { id: 'scene-water', kind: 'water', x: 8, y: -12 },
    ],
  }),
  prepare: (state) => {
    patchVehicle(state, BASE_SPAWN);
    state.economy.cargo = { scrap: 240, fuel: 80, water: 60 };
    const base = state.bases.items[0];
    if (base) base.storage = { scrap: 120, fuel: 80, water: 60 };
    setStructures(state, ['depot', 'workshop']);
  },
};

const RAID_SPAWN = { x: -7, y: -5, headingRadians: 0 };

const RAID: TestSceneDefinition = {
  id: 'raid',
  title: 'СЦЕНА: РЕЙД И ОБОРОНА БАЗЫ',
  summary: 'Рейд и оборона базы',
  guide: {
    goal: 'Проверить полный цикл рейда и работу автоматической обороны.',
    mechanics: 'Таймер рейда, предупреждение, живые рейдеры, турели, генератор, разграбление склада, отчёты о рейдах, урон сооружениям.',
    start: 'Машина рядом с базой в центре; на базе склад, две турели и генератор; склад богатый. Первый рейд запланирован через 2 с, предупреждение 4 с. Добыча и гараж не нужны.',
    steps: [
      'Дождаться предупреждения и появления рейдеров.',
      'Посмотреть, как турели стреляют по нападающим, а рейдеры идут к складу.',
      'Попробовать отогнать рейдеров своим оружием или уехать из зоны боя.',
      'Открыть вкладку «БАЗЫ» и посмотреть отчёт после окончания рейда.',
    ],
    expected: 'Рейд начинается по таймеру, рейдеры появляются живыми сущностями, турели наносят урон, склад теряет ресурсы только когда рейдеры до него добираются, после боя остаётся отчёт.',
    notCovered: 'Добыча, строительство, гараж, настройка качества, удалённое разрешение рейдов для далёких баз.',
  },
  config: sceneConfig({
    seedOffset: 0x04,
    spawn: RAID_SPAWN,
    props: [
      prop('scene-pad', 'pad', 0, 0),
      prop('scene-crate-a', 'crate', 9, 8),
      prop('scene-crate-b', 'crate', -12, 7),
      prop('scene-rock', 'rock', 18, -6),
    ],
    raids: {
      ...RAID_CONFIG,
      firstDelaySeconds: 2,
      countdownSeconds: 4,
      baseIntervalSeconds: 600,
      minStorageToRaid: 10,
      attackersBase: 3,
    },
  }),
  prepare: (state) => {
    patchVehicle(state, RAID_SPAWN);
    const base = state.bases.items[0];
    if (base) base.storage = { scrap: 220, fuel: 140, water: 140 };
    setStructures(state, ['depot', 'turret', 'generator', 'turret']);
  },
};

const TUTORIAL_SPAWN = { x: -8, y: 0, headingRadians: 0 };

/** Compact playground that contains every mechanic the tutorial asks for. */
const TUTORIAL: TestSceneDefinition = {
  id: 'tutorial',
  title: 'ОБУЧЕНИЕ',
  summary: 'Пошаговое обучение',
  config: sceneConfig({
    seedOffset: 0x05,
    spawn: TUTORIAL_SPAWN,
    props: [
      prop('scene-pad', 'pad', 6, 2),
      prop('scene-cover-a', 'crate', 10, -2),
      prop('scene-cover-b', 'crate', 12, 2),
      prop('scene-wreck', 'wreck', 22, 8),
    ],
    spawnResourceNodes: [
      { id: 'scene-scrap', kind: 'scrap', x: -4, y: -4 },
      { id: 'scene-fuel', kind: 'fuel', x: -2, y: 8 },
      { id: 'scene-water', kind: 'water', x: 8, y: -8 },
    ],
    enemySpawns: [
      { id: 'scene-target', kind: 'scrap-dummy', x: 16, y: 0, rotation: Math.PI },
    ],
  }),
  guide: {
    goal: 'Изучить управление и основные механики по шагам, без долгой подготовки.',
    mechanics: 'Кнопка движения, разгон, руль, задний ход, добыча, разгрузка, стройка, гараж и стрельба.',
    start: 'Машина на (-8, 0) рядом с базой, ресурсами и одной мишенью. Газ выключен, склад уже построен.',
    steps: [
      'Нажмите «ДВИЖЕНИЕ: ВЫКЛ», чтобы включить газ.',
      'Следуйте подсказкам в панели обучения: шаги меняются сами, когда вы выполняете действие.',
      'Застряли — нажмите «ПРОПУСТИТЬ» в панели обучения.',
    ],
    expected: 'Панель обучения показывает только текущий шаг и прогресс; после последнего шага появится сообщение об завершении.',
    notCovered: 'Рейды, удалённые базы, мобильные рейдеры, настройки графики.',
  },
  prepare: (state) => {
    patchVehicle(state, TUTORIAL_SPAWN);
    state.economy.cargo = { scrap: 160, fuel: 60, water: 60 };
    const base = state.bases.items[0];
    if (base) {
      base.storage = { scrap: 80, fuel: 60, water: 60 };
      setStructures(state, ['depot']);
    }
  },
};

const SCENES: Readonly<Record<TestSceneId, TestSceneDefinition>> = {
  driving: DRIVING,
  combat: COMBAT,
  base: BASE,
  raid: RAID,
  tutorial: TUTORIAL,
};

export const ALL_TEST_SCENES: readonly TestSceneDefinition[] = [
  DRIVING,
  COMBAT,
  BASE,
  RAID,
  TUTORIAL,
];

/** Returns null for an unknown id so the caller can show the available list. */
export function getTestScene(id: string | null): TestSceneDefinition | null {
  if (!id) return null;
  return SCENES[id as TestSceneId] ?? null;
}

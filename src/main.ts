import './styles.css';
import { Vec2 } from './core/math/Vec2';
import { GameApp } from './app/GameApp';
import type { AimControls } from './sim/input/AimCommand';
import type { DriveControls } from './sim/input/DriveCommand';
import type { CombatSnapshot, VehicleSnapshot } from './sim/world/WorldState';
import type { SaveSlotInfo } from './sim/persistence/SerializedGameState';
import { ECONOMY_CONFIG } from './data/economy';
import { createStructure } from './sim/base/BaseState';

interface RoadRageDebugApi {
  getTick(): number;
  getElapsedSeconds(): number;
  isPaused(): boolean;
  togglePause(): void;
  getVehicle(): VehicleSnapshot;
  getCombat(): CombatSnapshot;
  getChunks(): { active: number; loadedTotal: number; unloadedTotal: number };
  getEconomy(): {
    cargo: Record<string, number>;
    storage: Record<string, number>;
    cargoTotal: number;
    storageTotal: number;
    interaction: { kind: string; label: string } | null;
  };
  getGarage(): {
    open: boolean;
    selectedSlot: number;
    slots: { slotId: string; moduleId: string | null }[];
    levels: Record<string, number>;
    stats: Record<string, number>;
  };
  getBases(): {
    bases: {
      name: string;
      structures: number;
      kinds: string[];
      storage: Record<string, number>;
    }[];
    build: { action: string; label: string; affordable: boolean } | null;
  };
  /** Debug-only: move the car instantly (used by e2e tests). */
  teleport(x: number, y: number): void;
  /** Debug-only: top up the trunk so e2e/visual checks can build. */
  grantCargo(amounts: Partial<Record<'scrap' | 'fuel' | 'water', number>>): void;
  /** Debug-only: top up the selected base depot for defence checks. */
  grantStorage(amounts: Partial<Record<'scrap' | 'fuel' | 'water', number>>): void;
  /** Debug-only: make the raid planner fire on the next tick. */
  forceRaid(): void;
  /** Debug-only: put the car on the selected base and give it a workshop. */
  openGarage(): void;
  queueControls(controls: Partial<DriveControls>): void;
  queueAimControls(controls: Partial<AimControls>): void;
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
  isTouchControlsVisible(): boolean;
  listSaves(): readonly SaveSlotInfo[];
  saveGame(slot: number): Promise<string>;
  loadGame(slot: number): Promise<string>;
  deleteSave(slot: number): Promise<string>;
  openMenu(open: boolean): void;
  isMenuOpen(): boolean;
  selectBase(index: number): void;
}

declare global {
  interface Window {
    __roadrage?: RoadRageDebugApi;
  }
}

function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fatal = document.querySelector<HTMLElement>('#fatal-error');
  if (fatal) {
    fatal.hidden = false;
    fatal.textContent = `Не удалось запустить игру: ${message}`;
  }
}

function bootstrap(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
  const hudRoot = document.querySelector<HTMLElement>('#hud');

  if (!canvas || !hudRoot) {
    throw new Error('Не найдены элементы #game-canvas и/или #hud');
  }

  const app = new GameApp({ canvas, hudRoot });
  app.start();

  window.__roadrage = {
    getTick: () => app.tick,
    getElapsedSeconds: () => app.simulation.time.elapsedSeconds,
    isPaused: () => app.paused,
    togglePause: () => {
      app.togglePause();
    },
    getVehicle: () => app.simulation.snapshot().vehicle,
    getCombat: () => app.simulation.snapshot().combat,
    getChunks: () => app.simulation.snapshot().chunks,
    getEconomy: () => {
      const economy = app.simulation.snapshot().economy;
      return {
        cargo: { ...economy.cargo },
        storage: { ...economy.storage },
        cargoTotal: economy.cargoTotal,
        storageTotal: economy.storageTotal,
        interaction: economy.interaction
          ? { kind: economy.interaction.kind, label: economy.interaction.label }
          : null,
      };
    },
    getBases: () => {
      const baseState = app.simulation.snapshot().baseState;
      return {
        bases: baseState.bases.map((base) => ({
          name: base.name,
          structures: base.structures.length,
          kinds: base.structures.map((structure) => `${structure.kind}:${structure.active}`),
          storage: { ...base.storage },
        })),
        build: baseState.build
          ? {
              action: baseState.build.action,
              label: baseState.build.label,
              affordable: baseState.build.affordable,
            }
          : null,
      };
    },
    getGarage: () => {
      const garage = app.simulation.world.garage;
      return {
        open: app.simulation.snapshot().garage.info?.open ?? false,
        selectedSlot: garage.selectedSlot,
        slots: garage.slots.map((slot) => ({
          slotId: slot.slotId,
          moduleId: slot.moduleId,
        })),
        levels: { ...garage.levels },
        stats: { ...garage.stats },
      };
    },
    openGarage: () => {
      const world = app.simulation.world;
      const base = world.bases[world.selectedBaseIndex] ?? world.bases[0];
      if (base) {
        app.simulation.world.vehicle = {
          ...app.simulation.world.vehicle,
          position: new Vec2(base.x, base.y),
          velocity: Vec2.ZERO,
        };
        if (!base.structures.some((structure) => structure.kind === 'workshop')) {
          // Reuse the real constructor so debug bases cannot drift from the
          // structure schema.
          base.structures.push(
            createStructure({
              id: `struct-${base.id}-debug`,
              kind: 'workshop',
              x: base.x,
              y: base.y,
              slotIndex: base.structures.length,
              builtTick: app.tick,
              maxCondition: ECONOMY_CONFIG.maxCondition,
            }),
          );
        }
      }
    },
    grantCargo: (amounts) => {
      const cargo = app.simulation.world.economy.cargo;
      for (const kind of ['scrap', 'fuel', 'water'] as const) {
        const amount = amounts[kind];
        if (amount === undefined) continue;
        cargo[kind] = Math.max(0, cargo[kind] + amount);
      }
    },
    grantStorage: (amounts) => {
      const base = app.simulation.world.bases[app.simulation.world.selectedBaseIndex];
      if (!base) return;
      for (const kind of ['scrap', 'fuel', 'water'] as const) {
        const amount = amounts[kind];
        if (amount === undefined) continue;
        base.storage[kind] = Math.max(0, base.storage[kind] + amount);
      }
    },
    forceRaid: () => {
      const world = app.simulation.world;
      const base = world.bases[world.selectedBaseIndex];
      if (base && base.storage.scrap + base.storage.fuel + base.storage.water < 250) {
        base.storage.scrap += 300;
      }
      world.raidCooldownSeconds = 0;
    },
    teleport: (x, y) => {
      app.simulation.world.vehicle = {
        ...app.simulation.world.vehicle,
        position: new Vec2(x, y),
        velocity: Vec2.ZERO,
      };
    },
    queueControls: (controls) => {
      app.simulation.queueControls(controls);
    },
    queueAimControls: (controls) => {
      app.simulation.queueAimControls(controls);
    },
    worldToScreen: (x, y) => app.renderer.worldToScreen(x, y),
    isTouchControlsVisible: () =>
      app.touchControls.element.classList.contains('touch-controls--visible'),
    listSaves: () => app.listSaves(),
    saveGame: (slot) => app.saveGame(slot),
    loadGame: (slot) => app.loadGame(slot),
    deleteSave: (slot) => app.deleteSave(slot),
    openMenu: (open) => app.menu.setOpen(open),
    isMenuOpen: () => app.menu.isOpen,
    selectBase: (index) => app.selectBase(index),
  };

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      delete window.__roadrage;
      app.dispose();
    });
  }
}

try {
  bootstrap();
} catch (error) {
  console.error(error);
  showFatalError(error);
}

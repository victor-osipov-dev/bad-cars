import { FixedStepDriver } from '../core/loop/FixedStepDriver';
import { AutoSaveController, type AutoSaveSignals } from '../save/AutoSaveController';
import { MemorySaveStore } from '../save/MemorySaveStore';
import type { SaveStore } from '../save/SaveStore';
import { IndexedDbSaveStore, indexedDbAvailable } from '../platform/storage/IndexedDbSaveStore';
import { SAVE_SCHEMA_VERSION, type SaveSlotInfo } from '../sim/persistence/SerializedGameState';
import { GAME_CONFIG, type GameplayConfig } from '../data/gameplay';
import { RESOURCE_DEFINITIONS, RESOURCE_KINDS } from '../data/resources';
import { GameRenderer } from '../render/GameRenderer';
import { aimControlsEqual, type AimControls } from '../sim/input/AimCommand';
import { Simulation } from '../sim/Simulation';
import type { WorldSnapshot } from '../sim/world/WorldState';
import { Hud } from '../ui/Hud';
import { MenuOverlay, type MenuModel } from '../ui/MenuOverlay';
import { TouchControls } from '../ui/TouchControls';
import { CombatInput } from './CombatInput';
import { GARAGE_KEYS, garageActionFromKey } from './GarageInput';
import { InputManager } from './InputManager';

export interface GameAppOptions {
  readonly canvas: HTMLCanvasElement;
  readonly hudRoot: HTMLElement;
  readonly config?: GameplayConfig;
  /** Overridable for tests; defaults to IndexedDB with a memory fallback. */
  readonly saveStore?: SaveStore;
}

/**
 * Composition root: wires the deterministic simulation to the Babylon
 * renderer, DOM HUD and input sources. All frame-rate-dependent work lives
 * here, never in the simulation itself.
 */
/** Biome of the chunk currently under the vehicle. */
function currentBiome(snapshot: WorldSnapshot): string {
  const { vehicle, minimap } = snapshot;
  for (const chunk of minimap.chunks) {
    const size = chunk.size;
    if (
      vehicle.x >= chunk.chunkX * size &&
      vehicle.x < (chunk.chunkX + 1) * size &&
      vehicle.y >= chunk.chunkY * size &&
      vehicle.y < (chunk.chunkY + 1) * size
    ) {
      return chunk.biome;
    }
  }
  return '--';
}

export class GameApp {
  readonly simulation: Simulation;
  readonly renderer: GameRenderer;
  readonly driver: FixedStepDriver;
  readonly hud: Hud;
  readonly input: InputManager;
  readonly combatInput: CombatInput;
  readonly touchControls: TouchControls;
  readonly menu: MenuOverlay;
  readonly saveStore: SaveStore;

  readonly #config: GameplayConfig;
  readonly #autoSave: AutoSaveController;
  #saveSlots: readonly SaveSlotInfo[] = [];
  #activeSaveSlot = 1;
  #pausedBeforeMenu = false;
  #saving = false;
  #paused = false;
  #started = false;
  #disposed = false;
  #lastAimControls: AimControls | null = null;

  constructor(options: GameAppOptions) {
    this.#config = options.config ?? GAME_CONFIG;
    this.saveStore = options.saveStore ?? (indexedDbAvailable() ? new IndexedDbSaveStore() : new MemorySaveStore());
    this.simulation = new Simulation(this.#config);
    this.renderer = new GameRenderer(options.canvas, this.#config);
    this.driver = new FixedStepDriver(this.simulation.time, {
      maxSubSteps: this.#config.maxSubSteps,
      maxFrameDeltaSeconds: this.#config.maxFrameDeltaSeconds,
    });
    this.hud = new Hud(options.hudRoot, () => {
      this.togglePause();
    });
    this.input = new InputManager((controls) => {
      this.simulation.queueControls(controls);
    });
    this.combatInput = new CombatInput(options.canvas, (clientX, clientY) =>
      this.renderer.screenToWorld(clientX, clientY),
    );
    this.touchControls = new TouchControls(options.hudRoot, (state) => {
      this.input.setTouchState(state);
      this.combatInput.setTouchFire(state.fire);
    });
    this.menu = new MenuOverlay(options.hudRoot, {
      save: (slot) => this.saveGame(slot),
      load: (slot) => this.loadGame(slot),
      remove: (slot) => this.deleteSave(slot),
      selectBase: (index) => this.selectBase(index),
      onVisibilityChange: (open) => this.#onMenuVisibility(open),
    });
    this.#autoSave = new AutoSaveController(() => this.#autoSaveTick());
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;

    this.input.attach();
    this.combatInput.attach();
    void this.refreshSaveSlots();
    window.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);

    this.renderer.engine.runRenderLoop(this.#frame);
    this.#refreshHud();
  }

  togglePause(): void {
    this.setPaused(!this.#paused);
  }

  setPaused(paused: boolean): void {
    if (this.#paused === paused) return;
    this.#paused = paused;
    this.#refreshHud();
  }

  get paused(): boolean {
    return this.#paused;
  }

  get tick(): number {
    return this.simulation.time.tick;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    this.renderer.engine.stopRenderLoop(this.#frame);
    this.input.detach();
    this.combatInput.detach();
    window.removeEventListener('keydown', this.#onKeyDown);
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);

    this.menu.dispose();
    this.touchControls.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }

  readonly #frame = (): void => {
    const frameDeltaSeconds = this.renderer.engine.getDeltaTime() / 1000;
    this.#syncCombatInput();

    let alpha = 1;
    if (!this.#paused) {
      const result = this.driver.advance(frameDeltaSeconds, () => {
        this.simulation.step();
      });
      alpha = result.alpha;
    }

    const snapshot = this.simulation.snapshot();
    this.renderer.sync(snapshot, alpha, frameDeltaSeconds);
    this.renderer.render();
    this.#refreshHud(snapshot);
    if (!this.#paused) this.#autoSave.observe(this.#autoSaveSignals());
    this.menu.update(this.#menuModel(snapshot));
  };

  /** Refreshes the slot captions shown in the menu. */
  async refreshSaveSlots(): Promise<void> {
    try {
      this.#saveSlots = await this.saveStore.list();
    } catch (error) {
      this.#saveSlots = [1, 2, 3].map((slot) => ({
        slot,
        savedAt: null,
        tick: null,
        label: error instanceof Error ? `ОШИБКА: ${error.message}` : 'ОШИБКА ХРАНИЛИЩА',
      }));
    }
  }

  /** Current slot captions (also used by the debug API). */
  listSaves(): readonly SaveSlotInfo[] {
    return this.#saveSlots;
  }

  async saveGame(slot: number): Promise<string> {
    const file = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      // Metadata only: the simulation never reads wall-clock time.
      savedAt: Date.now(),
      game: this.simulation.exportState(),
    };
    await this.saveStore.save(slot, file);
    this.#activeSaveSlot = slot;
    await this.refreshSaveSlots();
    return `СОХРАНЕНО В СЛОТ ${slot}`;
  }

  async loadGame(slot: number): Promise<string> {
    const file = await this.saveStore.load(slot);
    if (!file) throw new Error(`Слот ${slot} пуст`);
    this.simulation.importState(file.game);
    this.#activeSaveSlot = slot;
    this.input.reset();
    this.combatInput.reset();
    this.#lastAimControls = null;
    this.#autoSave.reset(this.#autoSaveSignals());
    await this.refreshSaveSlots();
    this.#refreshHud();
    return `ЗАГРУЖЕНО ИЗ СЛОТА ${slot} · ТИК ${file.game.tick}`;
  }

  async deleteSave(slot: number): Promise<string> {
    await this.saveStore.remove(slot);
    await this.refreshSaveSlots();
    return `СЛОТ ${slot} ОЧИЩЕН`;
  }

  /** Focuses a base in the HUD/base menu; no teleport, just bookkeeping. */
  selectBase(index: number): void {
    const count = this.simulation.world.bases.length;
    if (count === 0) return;
    this.simulation.world.selectedBaseIndex = Math.min(count - 1, Math.max(0, index));
    this.#refreshHud();
  }

  readonly #onMenuVisibility = (open: boolean): void => {
    if (open) {
      this.#pausedBeforeMenu = this.#paused;
      this.input.reset();
      this.combatInput.reset();
      this.setPaused(true);
      return;
    }
    if (!this.#pausedBeforeMenu) this.setPaused(false);
  };

  #autoSaveSignals(): AutoSaveSignals {
    const world = this.simulation.world;
    return {
      tick: this.simulation.time.tick,
      baseCount: world.bases.length,
      structureCount: world.bases.reduce((count, base) => count + base.structures.length, 0),
      capturedCount: world.bases.filter((base) => base.captured).length,
      garageRevision: world.garage.revision,
    };
  }

  #autoSaveTick(): void {
    if (this.#saving) return;
    this.#saving = true;
    void this.saveGame(this.#activeSaveSlot)
      .catch(() => {
        // Storage errors are shown in the menu; autosave must never break the
        // render loop.
      })
      .finally(() => {
        this.#saving = false;
      });
  }

  #menuModel(snapshot: WorldSnapshot): MenuModel {
    const minimap = snapshot.minimap;
    return {
      slots: this.#saveSlots,
      activeSlot: this.#activeSaveSlot,
      map: {
        halfWidth: minimap.halfWidth,
        halfHeight: minimap.halfHeight,
        chunks: minimap.chunks,
        vehicle: {
          x: snapshot.vehicle.x,
          y: snapshot.vehicle.y,
          heading: snapshot.vehicle.heading,
        },
        bases: snapshot.baseState.bases.map((base) => ({
          name: base.name,
          x: base.x,
          y: base.y,
          captured: base.captured,
        })),
      },
      bases: snapshot.baseState.bases.map((base) => ({
        name: base.name,
        structures: base.structures.length,
        storageTotal:
          base.storage.scrap + base.storage.fuel + base.storage.water,
        captured: base.captured,
        selected: base.selected,
      })),
    };
  }

  #syncCombatInput(): void {
    const controls = this.combatInput.poll();
    if (this.#lastAimControls && aimControlsEqual(controls, this.#lastAimControls)) {
      return;
    }
    this.simulation.queueAimControls(controls);
    this.#lastAimControls = controls;
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (this.menu.handleKey(event.code)) {
      event.preventDefault();
      return;
    }
    // Garage keys are handled here rather than by InputManager: they are menu
    // actions, not drive axes, and pause/fire keys stay untouched.
    if (GARAGE_KEYS.has(event.code)) {
      const action = garageActionFromKey(event);
      if (action) {
        event.preventDefault();
        this.simulation.queueEquipmentAction(action);
      }
      return;
    }

    if (event.code !== 'Space') return;
    event.preventDefault();
    if (!event.repeat) {
      this.togglePause();
    }
  };

  readonly #onVisibilityChange = (): void => {
    if (document.hidden) {
      this.input.reset();
      this.combatInput.reset();
      this.setPaused(true);
    }
  };

  #refreshHud(snapshot: WorldSnapshot = this.simulation.snapshot()): void {
    const time = this.simulation.time;
    const combat = snapshot.combat;
    const targetsAlive = combat.enemies.reduce(
      (count, enemy) => count + (enemy.alive ? 1 : 0),
      0,
    );

    this.hud.update({
      tick: time.tick,
      elapsedSeconds: time.elapsedSeconds,
      dayIndex: time.dayIndex,
      hourOfDay: time.hourOfDay,
      fps: this.renderer.engine.getFps(),
      paused: this.#paused,
      speedKmh: snapshot.vehicle.speed * 3.6,
      activeSlot: combat.activeSlot,
      weapons: combat.weapons.map((weapon) => ({
        shortName: weapon.shortName,
        ammoInMagazine: weapon.ammoInMagazine,
        reserveAmmo: weapon.reserveAmmo,
        magazineSize: weapon.magazineSize,
        reloading: weapon.reloading,
        reloadProgress:
          weapon.reloading && weapon.reloadSeconds > 0
            ? 1 - weapon.reloadRemainingSeconds / weapon.reloadSeconds
            : 0,
      })),
      targetsAlive,
      targetsTotal: combat.enemies.length,
      threats: combat.threats,
      radarLabel: (() => {
        const sensors = snapshot.baseState.sensors;
        if (sensors.nearestDistance === null) return '—';
        return `${sensors.contacts} · ${Math.round(sensors.nearestDistance)}м`;
      })(),
      radarLevel: snapshot.baseState.sensors.level,
      baseAlarm: snapshot.baseState.sensors.alarmedBaseName
        ? `ТРЕВОГА: ${snapshot.baseState.sensors.alarmedBaseName}`
        : null,
      raidLabel: (() => {
        const raid = snapshot.baseState.raids[0];
        if (!raid) return '—';
        if (raid.phase === 'active') return 'БОЙ';
        const seconds = Math.max(0, Math.ceil(raid.secondsRemaining));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      })(),
      remoteReport: (() => {
        const reports = snapshot.baseState.remote.reports;
        const latest = reports.at(-1);
        if (!latest) return null;
        const labels: Record<string, string> = {
          produced: 'производство',
          deficit: 'дефицит',
          scrapped: 'списание',
        };
        return `${latest.baseName}: ${labels[latest.kind] ?? latest.kind} ${latest.detail}`;
      })(),
      raidReport: (() => {
        const report = snapshot.baseState.reports.at(-1);
        if (!report) return null;
        const label =
          report.outcome === 'repelled'
            ? 'ОТБИТО'
            : report.outcome === 'captured'
              ? 'ЗАХВАЧЕНА'
              : 'ОГРАБЛЕНА';
        const losses = report.looted > 0 ? ` −${report.looted}` : '';
        return `${label}: ${report.baseName}${losses}`;
      })(),
      health: snapshot.vehicle.health,
      maxHealth: snapshot.vehicle.maxHealth,
      destroyed: snapshot.vehicle.destroyed,
      biome: currentBiome(snapshot),
      chunksActive: snapshot.chunks.active,
      chunksLoadedTotal: snapshot.chunks.loadedTotal,
      chunksUnloadedTotal: snapshot.chunks.unloadedTotal,
      cargoTotal: snapshot.economy.cargoTotal,
      cargoCapacity: snapshot.economy.cargoCapacity,
      storageTotal: snapshot.economy.storageTotal,
      resources: RESOURCE_KINDS.map((kind) => ({
        shortName: RESOURCE_DEFINITIONS[kind].shortName,
        color: RESOURCE_DEFINITIONS[kind].color,
        cargo: snapshot.economy.cargo[kind],
        storage: snapshot.economy.storage[kind],
      })),
      prompt: snapshot.economy.interaction?.label ?? null,
      buildPrompt: snapshot.baseState.build?.label ?? null,
      buildCost: snapshot.baseState.build?.cost ?? null,
      buildAffordable: snapshot.baseState.build?.affordable ?? true,
      economy: {
        netLines: RESOURCE_KINDS.map((kind) => ({
          shortName: RESOURCE_DEFINITIONS[kind].shortName,
          perMinute:
            snapshot.baseState.bases.find((base) => base.selected)?.economy
              .netPerMinute[kind] ?? 0,
        })).filter((line) => line.perMinute !== 0),
        inactiveStructures:
          snapshot.baseState.bases.find((base) => base.selected)?.economy
            .inactiveStructures ?? 0,
        scrappedTotal:
          snapshot.baseState.bases.find((base) => base.selected)?.economy
            .scrappedTotal ?? 0,
      },
      bases: snapshot.baseState.bases.map((base) => ({
        name: base.name,
        structures: base.structures.length,
        storage:
          base.storage.scrap + base.storage.fuel + base.storage.water,
        selected: base.selected,
      })),
      garage: snapshot.garage.info
        ? {
            panelLabel: snapshot.garage.info.panelLabel,
            open: snapshot.garage.info.open,
            slots: snapshot.garage.info.slots.map((slot, index) => ({
              slotId: slot.slotId,
              label: slot.label,
              shortName: slot.shortName,
              selected: index === snapshot.garage.info?.selectedSlot,
            })),
            options: snapshot.garage.info.installOptions.map((option) => ({
              id: option.id,
              shortName: option.shortName,
              cost: option.cost,
              affordable: option.affordable,
              installed: option.installed,
            })),
            upgrades: snapshot.garage.info.upgrades.map((upgrade) => ({
              track: upgrade.track,
              level: upgrade.level,
              label: upgrade.label,
              cost: upgrade.cost,
              affordable: upgrade.affordable,
              maxed: upgrade.maxed,
            })),
            locker: snapshot.garage.info.locker.length,
            refusal: snapshot.garage.info.refusal,
            armor: snapshot.garage.stats.armor,
            cargoCapacity: snapshot.garage.stats.cargoCapacity,
          }
        : null,
      minimap: {
        halfWidth: snapshot.minimap.halfWidth,
        halfHeight: snapshot.minimap.halfHeight,
        chunks: snapshot.minimap.chunks.map((chunk) => ({
          x: chunk.chunkX * chunk.size,
          y: chunk.chunkY * chunk.size,
          size: chunk.size,
          biome: chunk.biome,
        })),
        player: {
          x: snapshot.vehicle.x,
          y: snapshot.vehicle.y,
          heading: snapshot.vehicle.heading,
        },
        enemies: combat.enemies
          .filter((enemy) => enemy.alive)
          .map((enemy) => ({ x: enemy.x, y: enemy.y })),
      },
    });
  }
}

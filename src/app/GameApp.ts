import { FixedStepDriver } from '../core/loop/FixedStepDriver';
import { FrameProfiler, type FrameStats } from './FrameProfiler';
import { AutoSaveController, type AutoSaveSignals } from '../save/AutoSaveController';
import { MemorySaveStore } from '../save/MemorySaveStore';
import type { SaveStore } from '../save/SaveStore';
import { IndexedDbSaveStore, indexedDbAvailable } from '../platform/storage/IndexedDbSaveStore';
import {
  SAVE_SCHEMA_VERSION,
  type SaveSlotInfo,
  type SerializedGameState,
} from '../sim/persistence/SerializedGameState';
import { GAME_CONFIG, type GameplayConfig } from '../data/gameplay';
import { RESOURCE_DEFINITIONS, RESOURCE_KINDS } from '../data/resources';
import { GameRenderer } from '../render/GameRenderer';
import {
  DEFAULT_RENDER_QUALITY,
  isRenderQuality,
  RENDER_QUALITY_OPTIONS,
  type RenderQuality,
} from '../render/RenderQuality';
import { aimControlsEqual, type AimControls } from '../sim/input/AimCommand';
import { Simulation } from '../sim/Simulation';
import type { WorldSnapshot } from '../sim/world/WorldState';
import { DriveToggle } from '../ui/DriveToggle';
import { Hud } from '../ui/Hud';
import { MenuOverlay, type MenuModel } from '../ui/MenuOverlay';
import { TouchControls } from '../ui/TouchControls';
import { CombatInput } from './CombatInput';
import { GARAGE_KEYS, garageActionFromKey } from './GarageInput';
import { InputManager } from './InputManager';
import { PauseReasons } from './PauseReasons';
import { TutorialController } from './TutorialController';

/** Manual-test scene wiring; the app keeps the state to restart on demand. */
export interface GameSceneOptions {
  readonly id: string;
  readonly label: string;
  readonly initialState: SerializedGameState;
}

export interface GameAppOptions {
  readonly canvas: HTMLCanvasElement;
  readonly hudRoot: HTMLElement;
  readonly config?: GameplayConfig;
  /** Overridable for tests; defaults to IndexedDB with a memory fallback. */
  readonly saveStore?: SaveStore;
  readonly scene?: GameSceneOptions;
}

/**
 * Composition root: wires the deterministic simulation to the Babylon
 * renderer, DOM HUD and input sources. All frame-rate-dependent work lives
 * here, never in the simulation itself.
 */
const QUALITY_STORAGE_KEY = 'roadrage.graphics-quality';

const TOUCH_GARAGE_CODES: Readonly<Record<string, string>> = {
  'slot-1': 'Digit1',
  'slot-2': 'Digit2',
  'garage-install': 'KeyG',
  'garage-remove': 'KeyH',
  'garage-engine': 'KeyN',
  'garage-chassis': 'KeyM',
  'garage-workshop': 'Comma',
};

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
  readonly driveToggle: DriveToggle;
  readonly tutorial: TutorialController | null;
  readonly combatInput: CombatInput;
  readonly touchControls: TouchControls;
  readonly menu: MenuOverlay;
  readonly saveStore: SaveStore;
  readonly frameProfiler = new FrameProfiler();

  readonly #config: GameplayConfig;
  readonly #autoSave: AutoSaveController;
  readonly #scene: GameSceneOptions | null;
  #saveSlots: readonly SaveSlotInfo[] = [];
  #activeSaveSlot = 1;
  #saving = false;
  readonly #pauseReasons = new PauseReasons();
  #started = false;
  #disposed = false;
  #lastAimControls: AimControls | null = null;
  #quality: RenderQuality = DEFAULT_RENDER_QUALITY;

  constructor(options: GameAppOptions) {
    this.#config = options.config ?? GAME_CONFIG;
    this.#scene = options.scene ?? null;
    this.saveStore = options.saveStore ?? (indexedDbAvailable() ? new IndexedDbSaveStore() : new MemorySaveStore());
    this.simulation = new Simulation(this.#config);
    this.renderer = new GameRenderer(options.canvas, this.#config);
    this.#quality = this.#readQuality();
    this.renderer.setQuality(this.#quality);
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
    this.driveToggle = new DriveToggle(options.hudRoot, (enabled) => {
      this.input.setDriveEnabled(enabled);
    });
    this.tutorial =
      options.scene?.id === 'tutorial'
        ? new TutorialController(options.hudRoot, {
            driveEnabled: () => this.input.driveEnabled,
            snapshot: () => this.simulation.snapshot(),
            world: () => this.simulation.world,
          })
        : null;
    this.combatInput = new CombatInput(options.canvas, (clientX, clientY) =>
      this.renderer.screenToWorld(clientX, clientY),
    );
    this.touchControls = new TouchControls(options.hudRoot, (state) => {
      this.input.setTouchState(state);
      this.combatInput.setTouchFire(state.fire);
    }, { onAction: (action) => this.#onTouchAction(action) });
    this.menu = new MenuOverlay(options.hudRoot, {
      save: (slot) => this.saveGame(slot),
      load: (slot) => this.loadGame(slot),
      remove: (slot) => this.deleteSave(slot),
      selectBase: (index) => this.selectBase(index),
      setQuality: (quality) => this.setRenderQuality(quality),
      onVisibilityChange: (open) => this.#onMenuVisibility(open),
    });
    this.#autoSave = new AutoSaveController(() => this.#autoSaveTick());
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;

    this.input.attach();
    this.input.sync();
    this.combatInput.attach();
    void this.refreshSaveSlots();
    window.addEventListener('keydown', this.#onKeyDown);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);

    this.renderer.engine.runRenderLoop(this.#frame);
    this.#refreshHud();
    this.menu.update(this.#menuModel(this.simulation.snapshot()));
  }

  togglePause(): void {
    this.#pauseReasons.toggle('manual');
    this.#refreshHud();
  }

  setPaused(paused: boolean): void {
    this.#setPauseReason('manual', paused);
  }

  get paused(): boolean {
    return this.#pauseReasons.active;
  }

  #setPauseReason(reason: 'manual' | 'menu' | 'focus', active: boolean): void {
    if (this.#pauseReasons.set(reason, active)) this.#refreshHud();
  }

  get tick(): number {
    return this.simulation.time.tick;
  }

  /** Active manual-test scene, or null during a normal run. */
  get sceneLabel(): string | null {
    return this.#scene?.label ?? null;
  }

  /** Restores the scene's opening state without touching any real save slot. */
  restartScene(): string {
    if (!this.#scene) return 'НЕТ АКТИВНОЙ СЦЕНЫ';
    this.simulation.importState(this.#scene.initialState);
    this.driver.reset();
    this.input.reset();
    this.combatInput.reset();
    this.#lastAimControls = null;
    this.menu.setOpen(false);
    this.#pauseReasons.clear();
    this.#autoSave.reset(this.#autoSaveSignals());
    this.#refreshHud();
    return `${this.#scene.label} · ПЕРЕЗАПУСК`;
  }

  /** Smoothed frame-budget report used by the HUD and debug API. */
  get frameStats(): FrameStats {
    return this.frameProfiler.stats;
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
    this.driveToggle.dispose();
    this.tutorial?.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }

  readonly #frame = (): void => {
    const frameDeltaSeconds = this.renderer.engine.getDeltaTime() / 1000;
    const simStart = performance.now();
    this.#syncCombatInput();

    let alpha = 1;
    let droppedSeconds = 0;
    if (!this.paused) {
      const result = this.driver.advance(frameDeltaSeconds, () => {
        this.simulation.step();
      });
      alpha = result.alpha;
      droppedSeconds = result.droppedSeconds;
    }

    const syncStart = performance.now();
    const snapshot = this.simulation.snapshot();
    this.renderer.sync(snapshot, alpha, frameDeltaSeconds);
    const renderStart = performance.now();
    this.renderer.render();
    const frameEnd = performance.now();

    this.touchControls.setGarageVisible(snapshot.garage.info?.open ?? false);
    this.frameProfiler.sample({
      frameSeconds: frameDeltaSeconds,
      simSeconds: (syncStart - simStart) / 1000,
      syncSeconds: (renderStart - syncStart) / 1000,
      renderSeconds: (frameEnd - renderStart) / 1000,
      droppedSeconds,
    });

    this.#refreshHud(snapshot);
    this.tutorial?.update();
    if (!this.paused) this.#autoSave.observe(this.#autoSaveSignals());
    this.menu.update(this.#menuModel(snapshot));
  };

  /** Applies and persists a graphics preset; never affects simulation state. */
  setRenderQuality(quality: string): string {
    if (!isRenderQuality(quality)) throw new Error(`Неизвестное качество: ${quality}`);
    this.#quality = quality;
    this.renderer.setQuality(quality);
    try {
      localStorage.setItem(QUALITY_STORAGE_KEY, quality);
    } catch {
      // Storage may be blocked; the preset still applies to this session.
    }
    this.#refreshHud();
    const option = RENDER_QUALITY_OPTIONS.find((entry) => entry.id === quality);
    return `КАЧЕСТВО: ${option?.label ?? quality.toUpperCase()}`;
  }

  get renderQuality(): RenderQuality {
    return this.#quality;
  }

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
      this.input.reset();
      this.combatInput.reset();
    }
    this.#setPauseReason('menu', open);
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
      savesEnabled: this.#scene === null,
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
      quality: this.#quality,
      qualityOptions: RENDER_QUALITY_OPTIONS,
    };
  }

  #readQuality(): RenderQuality {
    try {
      const stored = localStorage.getItem(QUALITY_STORAGE_KEY);
      if (isRenderQuality(stored)) return stored;
    } catch {
      // Private mode and disabled storage simply use the default preset.
    }
    return DEFAULT_RENDER_QUALITY;
  }

  /** Touch buttons reuse the keyboard action mapping, so both paths stay in sync. */
  #onTouchAction(action: string): void {
    const code = TOUCH_GARAGE_CODES[action];
    if (!code) return;
    const equipment = garageActionFromKey({
      code,
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    });
    if (!equipment) return;
    this.simulation.queueEquipmentAction(equipment);

    if (action === 'slot-1' || action === 'slot-2') {
      // Digit keys also select the firing slot on the keyboard path.
      const slot = action === 'slot-1' ? 0 : 1;
      this.simulation.queueAimControls({ ...this.combatInput.poll(), activeSlot: slot });
    }
  }

  #syncCombatInput(): void {
    const controls = this.combatInput.poll();    if (this.#lastAimControls && aimControlsEqual(controls, this.#lastAimControls)) {
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

    // W toggles the same master switch as the on-screen button. The pedal is
    // automatic once enabled, so a single press starts and stops the car.
    if (event.code === 'KeyW') {
      event.preventDefault();
      if (!event.repeat && !this.menu.isOpen) this.driveToggle.toggle();
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
    }
    // Leaving the tab adds a pause reason; returning clears exactly that one,
    // so a manual pause or an open menu is never accidentally removed.
    this.#setPauseReason('focus', document.hidden);
  };

  #refreshHud(snapshot: WorldSnapshot = this.simulation.snapshot()): void {
    const time = this.simulation.time;
    const combat = snapshot.combat;
    const frame = this.frameProfiler.stats;
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
      frameMs: frame.frameMs,
      simMs: frame.simMs,
      renderMs: frame.renderMs,
      droppedSeconds: frame.droppedSeconds,
      paused: this.paused,
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

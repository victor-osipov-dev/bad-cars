import { FixedStepDriver } from '../core/loop/FixedStepDriver';
import { GAME_CONFIG, type GameplayConfig } from '../data/gameplay';
import { RESOURCE_DEFINITIONS, RESOURCE_KINDS } from '../data/resources';
import { GameRenderer } from '../render/GameRenderer';
import { aimControlsEqual, type AimControls } from '../sim/input/AimCommand';
import { Simulation } from '../sim/Simulation';
import type { WorldSnapshot } from '../sim/world/WorldState';
import { Hud } from '../ui/Hud';
import { TouchControls } from '../ui/TouchControls';
import { CombatInput } from './CombatInput';
import { InputManager } from './InputManager';

export interface GameAppOptions {
  readonly canvas: HTMLCanvasElement;
  readonly hudRoot: HTMLElement;
  readonly config?: GameplayConfig;
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

  readonly #config: GameplayConfig;
  #paused = false;
  #started = false;
  #disposed = false;
  #lastAimControls: AimControls | null = null;

  constructor(options: GameAppOptions) {
    this.#config = options.config ?? GAME_CONFIG;
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
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;

    this.input.attach();
    this.combatInput.attach();
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
  };

  #syncCombatInput(): void {
    const controls = this.combatInput.poll();
    if (this.#lastAimControls && aimControlsEqual(controls, this.#lastAimControls)) {
      return;
    }
    this.simulation.queueAimControls(controls);
    this.#lastAimControls = controls;
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
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

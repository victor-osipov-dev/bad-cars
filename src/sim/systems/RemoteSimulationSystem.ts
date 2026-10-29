import { REMOTE_CONFIG, type RemoteConfig } from '../../data/remote';
import type { BaseState } from '../base/BaseState';
import type { EconomySystem } from './EconomySystem';
import type { SimulationContext, System } from '../System';

export type RemoteEventKind = 'produced' | 'deficit' | 'scrapped';

export interface RemoteReport {
  readonly id: number;
  readonly tick: number;
  readonly baseName: string;
  readonly kind: RemoteEventKind;
  readonly detail: string;
}

/**
 * Coarse simulation for bases the player is away from.
 *
 * One abstract tick covers `abstractIntervalSeconds` of world time, so a base
 * across the map costs a fraction of a local one. The per-frame budget caps
 * how many ticks can run, and anything left over is dropped rather than
 * queued: the world must never spend an unbounded amount of time catching up
 * inside a single frame.
 */
export class RemoteSimulationSystem implements System {
  readonly id = 'remote-simulation';
  readonly #config: RemoteConfig;
  readonly #economy: EconomySystem;

  constructor(economy: EconomySystem, config: RemoteConfig = REMOTE_CONFIG) {
    this.#economy = economy;
    this.#config = config;
  }

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;

    // Nothing far away means no abstract work at all: drop the accumulator so
    // a later trip does not trigger a burst of stale ticks.
    if (!this.#hasRemoteBase(context)) {
      world.remoteAccumulator = 0;
      return;
    }

    world.remoteAccumulator += deltaSeconds;

    let ticks = 0;
    while (
      world.remoteAccumulator >= this.#config.abstractIntervalSeconds &&
      ticks < this.#config.maxAbstractTicksPerFrame
    ) {
      world.remoteAccumulator -= this.#config.abstractIntervalSeconds;
      this.abstractTick(context);
      ticks += 1;
    }

    // A long stall must not leave a growing backlog of abstract ticks.
    if (ticks >= this.#config.maxAbstractTicksPerFrame) {
      world.remoteAccumulator = 0;
    }
  }

  #hasRemoteBase(context: SimulationContext): boolean {
    const { x, y } = context.world.vehicle.position;
    return context.world.bases.some(
      (base) => Math.hypot(base.x - x, base.y - y) > this.#config.remoteRadius,
    );
  }

  /** Advances every remote base by one abstract interval. */
  abstractTick(context: SimulationContext): void {
    const world = context.world;
    const { x, y } = world.vehicle.position;

    for (const base of world.bases) {
      if (Math.hypot(base.x - x, base.y - y) <= this.#config.remoteRadius) continue;
      this.#tickBase(context, base);
    }

    world.remoteTicks += 1;
  }

  /**
   * Fast-forwards remote bases without touching the render clock.
   *
   * Returns the number of abstract ticks actually applied; `truncated` is true
   * when the requested span exceeded the budget, so callers can tell the
   * player that the world did not fully catch up.
   */
  catchUp(context: SimulationContext, elapsedSeconds: number): {
    ticks: number;
    truncated: boolean;
  } {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return { ticks: 0, truncated: false };
    }

    const requested = Math.ceil(elapsedSeconds / this.#config.abstractIntervalSeconds);
    const ticks = Math.min(requested, this.#config.maxCatchUpTicks);
    for (let index = 0; index < ticks; index += 1) {
      this.abstractTick(context);
    }

    return { ticks, truncated: requested > ticks };
  }

  #tickBase(context: SimulationContext, base: BaseState): void {
    const beforeStructures = base.structures.length;
    const beforeProduced = base.structures.reduce(
      (sum, structure) => sum + structure.producedTotal,
      0,
    );
    const beforeStorage = base.storage.scrap + base.storage.fuel + base.storage.water;

    this.#economy.tickBase(base, this.#config.abstractIntervalSeconds);

    const afterProduced = base.structures.reduce(
      (sum, structure) => sum + structure.producedTotal,
      0,
    );
    const afterStorage = base.storage.scrap + base.storage.fuel + base.storage.water;

    if (base.structures.length < beforeStructures) {
      this.#report(context, base, 'scrapped', 'сооружение списано');
      return;
    }
    if (afterProduced > beforeProduced) {
      this.#report(context, base, 'produced', `+${afterProduced - beforeProduced} ед.`);
      return;
    }
    if (afterStorage < beforeStorage) {
      this.#report(context, base, 'deficit', 'содержание');
    }
  }

  #report(
    context: SimulationContext,
    base: BaseState,
    kind: RemoteEventKind,
    detail: string,
  ): void {
    const world = context.world;
    world.remoteReports.push({
      id: world.nextRemoteReportId,
      tick: context.time.tick,
      baseName: base.name,
      kind,
      detail,
    });
    world.nextRemoteReportId += 1;
    if (world.remoteReports.length > this.#config.maxReports) {
      world.remoteReports.splice(0, world.remoteReports.length - this.#config.maxReports);
    }
  }
}

import { Vec2 } from '../../core/math/Vec2';
import { ENEMY_DEFINITIONS } from '../../data/enemies';
import { RESOURCE_KINDS, type ResourceKind } from '../../data/resources';
import { RAID_CONFIG, type RaidConfig } from '../../data/raids';
import type { BaseState, StructureState } from '../base/BaseState';
import type { EnemyState } from '../combat/CombatState';
import { MAX_RAID_REPORTS, type RaidOutcome, type RaidState } from '../raid/RaidState';
import type { SimulationContext, System } from '../System';

function storageSum(base: BaseState): number {
  return base.storage.scrap + base.storage.fuel + base.storage.water;
}

/** Removes `amount` from a base depot, spreading the loss over what it holds. */
function steal(base: BaseState, amount: number): number {
  const total = storageSum(base);
  if (total <= 0) return 0;

  let remaining = Math.min(amount, total);
  const taken = remaining;
  // Proportional removal keeps the resource mix intact and the total exact.
  for (const kind of RESOURCE_KINDS) {
    const share = Math.floor((base.storage[kind] / total) * taken);
    base.storage[kind] -= share;
    remaining -= share;
  }
  // Rounding leftovers come out of whatever is still available.
  for (const kind of RESOURCE_KINDS) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, base.storage[kind]);
    base.storage[kind] -= take;
    remaining -= take;
  }
  return taken - remaining;
}

/**
 * Raid planning and resolution.
 *
 * A raid is planned on a timer (shorter with more bases and with a wealthy
 * depot), warns for `countdownSeconds`, then either becomes a live attack with
 * spawned raiders when the player is near the base, or resolves abstractly.
 * The abstract path is what makes bases meaningful while the player is away:
 * turrets stop attackers, and anything that leaks through loots the depot and
 * damages structures.
 */
export class RaidSystem implements System {
  readonly id = 'raids';
  readonly #config: RaidConfig;

  constructor(config: RaidConfig = RAID_CONFIG) {
    this.#config = config;
  }

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;

    for (const raid of [...world.raids]) {
      if (raid.phase === 'incoming') {
        this.#tickIncoming(context, raid, deltaSeconds);
        continue;
      }
      this.#tickActive(context, raid, deltaSeconds);
    }

    if (world.raids.length > 0) return;

    world.raidCooldownSeconds = Math.max(0, world.raidCooldownSeconds - deltaSeconds);
    if (world.raidCooldownSeconds > 0) return;

    this.#plan(context);
  }

  #plan(context: SimulationContext): void {
    const world = context.world;
    const candidates = world.bases.filter(
      (base) => !base.captured && storageSum(base) >= this.#config.minStorageToRaid,
    );
    if (candidates.length === 0) {
      // Nothing worth raiding: check again later without spamming attempts.
      world.raidCooldownSeconds = this.#config.countdownSeconds;
      return;
    }

    // Rotate the target so several bases share the pressure, newest last.
    const target = candidates[world.nextRaidId % candidates.length];
    if (!target) return;

    const extraBases = Math.max(0, world.bases.length - 1);
    const attackers =
      this.#config.attackersBase + extraBases * this.#config.attackersPerExtraBase;

    world.raids.push({
      id: `raid-${world.nextRaidId}`,
      baseId: target.id,
      baseName: target.name,
      phase: 'incoming',
      secondsRemaining: this.#config.countdownSeconds,
      attackers,
      attackerIds: [],
      looted: 0,
      damagedStructures: 0,
    });
    world.nextRaidId += 1;
    world.raidCooldownSeconds = this.#nextInterval(world.bases.length, storageSum(target));
  }

  #nextInterval(baseCount: number, wealth: number): number {
    const extra = Math.max(0, baseCount - 1);
    let interval = this.#config.baseIntervalSeconds - extra * this.#config.intervalPerExtraBase;
    if (wealth >= this.#config.wealthThreshold) {
      interval *= this.#config.wealthyIntervalMultiplier;
    }
    return Math.max(this.#config.minIntervalSeconds, Math.round(interval));
  }

  #tickIncoming(
    context: SimulationContext,
    raid: RaidState,
    deltaSeconds: number,
  ): void {
    raid.secondsRemaining -= deltaSeconds;
    if (raid.secondsRemaining > 0) return;

    const base = context.world.bases.find((entry) => entry.id === raid.baseId);
    if (!base || base.captured) {
      this.#finish(context, raid, 'repelled', true, 0, 0);
      return;
    }

    const playerDistance = Math.hypot(
      context.world.vehicle.position.x - base.x,
      context.world.vehicle.position.y - base.y,
    );
    const live = playerDistance <= this.#config.liveRadius;

    if (!live) {
      this.#resolveOffline(context, raid, base);
      return;
    }

    raid.phase = 'active';
    raid.secondsRemaining = this.#config.maxLiveSeconds;
    raid.attackerIds = this.#spawnAttackers(context, base, raid);
  }

  /** Player nearby: raiders are real entities and the fight is simulated. */
  #spawnAttackers(
    context: SimulationContext,
    base: BaseState,
    raid: RaidState,
  ): string[] {
    const world = context.world;
    const definition = ENEMY_DEFINITIONS.raider;
    const ids: string[] = [];

    for (let index = 0; index < raid.attackers; index += 1) {
      const angle = (index / Math.max(1, raid.attackers)) * Math.PI * 2;
      const radius = this.#config.baseRadius + 3;
      const x = base.x + Math.cos(angle) * radius;
      const y = base.y + Math.sin(angle) * radius;
      const id = `raid-${raid.id}-${index}`;

      const enemy: EnemyState = {
        id,
        kind: 'raider',
        spawnX: x,
        spawnY: y,
        rotation: angle,
        aimAngle: angle,
        radius: definition.radius,
        maxHealth: definition.maxHealth,
        position: new Vec2(x, y),
        health: definition.maxHealth,
        alive: true,
        respawnRemainingSeconds: 0,
        fireCooldownSeconds: definition.weapon?.fireIntervalSeconds ?? 0,
        aiState: 'attack',
        stateSeconds: 0,
        bestDistance: Number.POSITIVE_INFINITY,
        stallSeconds: 0,
        patrolAngle: angle,
        raidId: raid.id,
      };
      world.enemies.push(enemy);
      ids.push(id);
    }

    return ids;
  }

  /** Player away: resolve with a defence-vs-attackers comparison. */
  #resolveOffline(
    context: SimulationContext,
    raid: RaidState,
    base: BaseState,
  ): void {
    const turrets = base.structures.filter(
      (structure) => structure.kind === 'turret' && structure.active,
    ).length;
    const mines = base.structures.filter(
      (structure) => structure.kind === 'mine' && structure.active,
    ).length;

    // Mines are single-use, so they stop one attacker each and are consumed.
    const mineBlocks = Math.min(mines, Math.max(0, raid.attackers - turrets));
    for (let index = 0; index < mineBlocks; index += 1) {
      const mine = base.structures.find((structure) => structure.kind === 'mine');
      if (!mine) break;
      base.structures = base.structures.filter((structure) => structure !== mine);
      base.minesSpent += 1;
    }

    const blocked = Math.min(raid.attackers, turrets + mineBlocks);
    const leaked = Math.max(0, raid.attackers - blocked);

    let looted = 0;
    let lost = 0;
    if (leaked > 0) {
      looted = steal(base, leaked * this.#config.lootPerAttackerOffline);
      lost = this.#damageStructures(base, leaked);
    }

    const captured =
      base.structures.length === 0 && storageSum(base) === 0 && leaked > 0;

    if (captured) base.captured = true;

    const outcome: RaidOutcome = captured ? 'captured' : leaked === 0 ? 'repelled' : 'looted';
    this.#finish(context, raid, outcome, false, looted, lost);
  }

  #damageStructures(base: BaseState, leaked: number): number {
    let lost = 0;
    for (let index = 0; index < leaked; index += 1) {
      const target = base.structures[index % Math.max(1, base.structures.length)];
      if (!target) break;
      target.condition -= 1;
      if (target.condition <= 0) {
        base.structures = base.structures.filter((structure) => structure !== target);
        base.scrappedCount += 1;
        lost += 1;
      }
    }
    return lost;
  }

  #tickActive(
    context: SimulationContext,
    raid: RaidState,
    deltaSeconds: number,
  ): void {
    const world = context.world;
    raid.secondsRemaining -= deltaSeconds;

    const base = world.bases.find((entry) => entry.id === raid.baseId);
    const attackers = world.enemies.filter(
      (enemy) => enemy.raidId === raid.id && enemy.alive,
    );

    if (!base) {
      this.#finish(context, raid, 'repelled', true, Math.floor(raid.looted), 0);
      return;
    }

    // Every attacker standing at the base steals and breaks things.
    for (const enemy of attackers) {
      const distance = Math.hypot(
        enemy.position.x - base.x,
        enemy.position.y - base.y,
      );
      if (distance > this.#config.baseRadius) continue;

      // `steal` returns what was actually taken, so an empty depot cannot
      // inflate the reported losses.
      raid.looted += steal(base, this.#config.lootPerSecond * deltaSeconds);

      const target: StructureState | undefined = base.structures[0];
      if (target) {
        target.condition -= this.#config.structureDamagePerSecond * deltaSeconds;
        if (target.condition <= 0) {
          base.structures = base.structures.filter((structure) => structure !== target);
          base.scrappedCount += 1;
          raid.damagedStructures += 1;
        }
      }
    }

    if (attackers.length === 0) {
      this.#finish(context, raid, 'repelled', true, Math.floor(raid.looted), raid.damagedStructures);
      return;
    }

    if (raid.secondsRemaining <= 0) {
      // Raiders leave with what they took.
      for (const enemy of attackers) enemy.alive = false;
      world.enemies = world.enemies.filter((enemy) => enemy.raidId !== raid.id);
      this.#finish(context, raid, 'looted', true, Math.floor(raid.looted), raid.damagedStructures);
    }
  }

  #finish(
    context: SimulationContext,
    raid: RaidState,
    outcome: RaidOutcome,
    live: boolean,
    looted: number,
    structuresLost: number,
  ): void {
    const world = context.world;
    world.raids = world.raids.filter((entry) => entry.id !== raid.id);
    world.raidReports.push({
      id: raid.id,
      baseName: raid.baseName,
      tick: context.time.tick,
      live,
      outcome,
      looted,
      structuresLost,
    });
    if (world.raidReports.length > MAX_RAID_REPORTS) {
      world.raidReports.splice(0, world.raidReports.length - MAX_RAID_REPORTS);
    }
  }
}

export type { ResourceKind };

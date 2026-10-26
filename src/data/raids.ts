/**
 * Raid planning and resolution tuning.
 *
 * Raids are the pressure that makes a base a liability: they are scheduled on
 * a timer, scale with the number of bases and the wealth stored in them, and
 * resolve either live (player nearby) or abstractly (player away).
 */

export interface RaidConfig {
  /** Grace period before the first raid can be planned, seconds. */
  readonly firstDelaySeconds: number;
  /** Base interval between raids with one base, seconds. */
  readonly baseIntervalSeconds: number;
  /** Interval cannot drop below this however many bases exist. */
  readonly minIntervalSeconds: number;
  /** Each extra base shortens the interval by this much, seconds. */
  readonly intervalPerExtraBase: number;
  /** A wealthy base is raided more often; multiplier applied to the interval. */
  readonly wealthyIntervalMultiplier: number;
  /** Storage total that counts as "wealthy". */
  readonly wealthThreshold: number;
  /** Warning time before a raid strikes, seconds. */
  readonly countdownSeconds: number;
  /** Attackers in the first wave, plus one per extra base. */
  readonly attackersBase: number;
  readonly attackersPerExtraBase: number;
  /** Player within this distance of the base fights the raid live. */
  readonly liveRadius: number;
  /** Distance from the base at which raiders attack it, world units. */
  readonly baseRadius: number;
  /** Loot taken per raider per second while it is at the base. */
  readonly lootPerSecond: number;
  /** Condition damage per raider per second while it is at the base. */
  readonly structureDamagePerSecond: number;
  /** A live raid gives up after this long, seconds. */
  readonly maxLiveSeconds: number;
  /** Loot taken per unopposed attacker when a raid resolves offline. */
  readonly lootPerAttackerOffline: number;
  /** Bases below this storage total are not worth raiding. */
  readonly minStorageToRaid: number;
}

export const RAID_CONFIG: RaidConfig = {
  firstDelaySeconds: 180,
  baseIntervalSeconds: 420,
  minIntervalSeconds: 150,
  intervalPerExtraBase: 60,
  wealthyIntervalMultiplier: 0.75,
  wealthThreshold: 250,
  countdownSeconds: 30,
  attackersBase: 2,
  attackersPerExtraBase: 1,
  liveRadius: 60,
  baseRadius: 14,
  lootPerSecond: 1.5,
  structureDamagePerSecond: 0.05,
  maxLiveSeconds: 90,
  lootPerAttackerOffline: 18,
  minStorageToRaid: 250,
};

export function validateRaidConfig(config: RaidConfig): readonly string[] {
  const errors: string[] = [];

  const positive: readonly [string, number][] = [
    ['firstDelaySeconds', config.firstDelaySeconds],
    ['baseIntervalSeconds', config.baseIntervalSeconds],
    ['minIntervalSeconds', config.minIntervalSeconds],
    ['countdownSeconds', config.countdownSeconds],
    ['liveRadius', config.liveRadius],
    ['baseRadius', config.baseRadius],
    ['maxLiveSeconds', config.maxLiveSeconds],
    ['lootPerAttackerOffline', config.lootPerAttackerOffline],
    ['minStorageToRaid', config.minStorageToRaid],
  ];
  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${name} must be a finite positive number`);
    }
  }

  if (!Number.isInteger(config.attackersBase) || config.attackersBase < 1) {
    errors.push('attackersBase must be a positive integer');
  }
  if (!Number.isInteger(config.attackersPerExtraBase) || config.attackersPerExtraBase < 0) {
    errors.push('attackersPerExtraBase must be a non-negative integer');
  }
  if (config.minIntervalSeconds > config.baseIntervalSeconds) {
    errors.push('minIntervalSeconds cannot exceed baseIntervalSeconds');
  }
  if (config.baseRadius >= config.liveRadius) {
    errors.push('baseRadius must be smaller than liveRadius');
  }
  if (config.lootPerSecond < 0 || config.structureDamagePerSecond < 0) {
    errors.push('raid rates must be non-negative');
  }

  return errors;
}

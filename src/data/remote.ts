/**
 * Remote base simulation.
 *
 * Bases far from the player are not worth updating every 60 Hz tick: they are
 * advanced in coarse "abstract" ticks instead. The work per frame is bounded
 * by `maxAbstractTicksPerFrame`, and loading a save catches up through
 * `maxCatchUpTicks` steps, so a long absence can never stall the frame.
 */

export interface RemoteConfig {
  /** Player within this distance keeps a base on the full 60 Hz economy. */
  readonly remoteRadius: number;
  /** Simulated seconds covered by one abstract tick. */
  readonly abstractIntervalSeconds: number;
  /** Hard cap on abstract ticks per frame. */
  readonly maxAbstractTicksPerFrame: number;
  /** Hard cap on catch-up ticks when time is fast-forwarded. */
  readonly maxCatchUpTicks: number;
  /** How many remote reports are kept for the HUD log. */
  readonly maxReports: number;
}

export const REMOTE_CONFIG: RemoteConfig = {
  remoteRadius: 120,
  abstractIntervalSeconds: 5,
  maxAbstractTicksPerFrame: 4,
  maxCatchUpTicks: 600,
  maxReports: 8,
};

export function validateRemoteConfig(config: RemoteConfig): readonly string[] {
  const errors: string[] = [];

  if (!Number.isFinite(config.remoteRadius) || config.remoteRadius <= 0) {
    errors.push('remoteRadius must be a finite positive number');
  }
  if (
    !Number.isFinite(config.abstractIntervalSeconds) ||
    config.abstractIntervalSeconds <= 0
  ) {
    errors.push('abstractIntervalSeconds must be a finite positive number');
  }
  if (
    !Number.isInteger(config.maxAbstractTicksPerFrame) ||
    config.maxAbstractTicksPerFrame < 1
  ) {
    errors.push('maxAbstractTicksPerFrame must be a positive integer');
  }
  if (!Number.isInteger(config.maxCatchUpTicks) || config.maxCatchUpTicks < 1) {
    errors.push('maxCatchUpTicks must be a positive integer');
  }
  if (!Number.isInteger(config.maxReports) || config.maxReports < 1) {
    errors.push('maxReports must be a positive integer');
  }

  return errors;
}

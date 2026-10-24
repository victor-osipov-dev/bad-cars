import { EFFECT_CONFIGS, MAX_ACTIVE_EFFECTS } from '../../data/effects';
import type { WorldState } from '../world/WorldState';

/**
 * Appends a transient effect. Effects are cosmetic, so the oldest one is
 * dropped when the cap is reached; this keeps renderer load bounded.
 */
export function spawnEffect(
  world: WorldState,
  kind: keyof typeof EFFECT_CONFIGS,
  x: number,
  y: number,
  rotation = 0,
): void {
  if (world.effects.length >= MAX_ACTIVE_EFFECTS) {
    world.effects.shift();
  }
  world.effects.push({
    id: world.nextEffectId,
    kind,
    x,
    y,
    rotation,
    ageSeconds: 0,
    lifetimeSeconds: EFFECT_CONFIGS[kind].lifetimeSeconds,
  });
  world.nextEffectId += 1;
}

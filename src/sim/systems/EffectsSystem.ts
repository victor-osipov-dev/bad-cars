import type { EffectState } from '../combat/CombatState';
import type { SimulationContext, System } from '../System';

/** Ages and removes transient combat effects. */
export class EffectsSystem implements System {
  readonly id = 'effects';

  update(context: SimulationContext, deltaSeconds: number): void {
    const survivors: EffectState[] = [];
    for (const effect of context.world.effects) {
      effect.ageSeconds += deltaSeconds;
      if (effect.ageSeconds < effect.lifetimeSeconds) {
        survivors.push(effect);
      }
    }
    context.world.effects = survivors;
  }
}

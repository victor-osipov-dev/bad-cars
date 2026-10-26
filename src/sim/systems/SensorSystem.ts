import { SENSOR_CONFIG, type AlertLevel, type SensorConfig } from '../../data/defense';
import type { SimulationContext, System } from '../System';

export interface SensorState {
  readonly level: AlertLevel;
  /** Closest hostile distance to the vehicle, or null when the radar is clear. */
  readonly nearestDistance: number | null;
  /** Hostiles inside the radar radius. */
  readonly contacts: number;
  /** True when a hostile is close to any base. */
  readonly baseAlarm: boolean;
  /** Base closest to a hostile, for the notification text. */
  readonly alarmedBaseName: string | null;
}

export function idleSensors(): SensorState {
  return {
    level: 'calm',
    nearestDistance: null,
    contacts: 0,
    baseAlarm: false,
    alarmedBaseName: null,
  };
}

/**
 * Cheap radar and base alarm.
 *
 * One distance check per living enemy per tick: the enemy list is small and
 * budget-capped, so a spatial index would be overkill here.
 */
export class SensorSystem implements System {
  readonly id = 'sensors';
  readonly #config: SensorConfig;

  constructor(config: SensorConfig = SENSOR_CONFIG) {
    this.#config = config;
  }

  update(context: SimulationContext, _deltaSeconds: number): void {
    const world = context.world;
    const vehicle = world.vehicle.position;

    let contacts = 0;
    let nearestDistance: number | null = null;

    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - vehicle.x;
      const dy = enemy.position.y - vehicle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > this.#config.radarRadius) continue;

      contacts += 1;
      if (nearestDistance === null || distance < nearestDistance) {
        nearestDistance = distance;
      }
    }

    let alarmedBaseName: string | null = null;
    if (contacts > 0) {
      const baseSquared = this.#config.baseSensorRadius * this.#config.baseSensorRadius;
      for (const base of world.bases) {
        const close = world.enemies.some(
          (enemy) =>
            enemy.alive &&
            (enemy.position.x - base.x) ** 2 + (enemy.position.y - base.y) ** 2 <=
              baseSquared,
        );
        if (close) {
          alarmedBaseName = base.name;
          break;
        }
      }
    }

    let level: AlertLevel = 'calm';
    if (nearestDistance !== null) {
      level = nearestDistance <= this.#config.attackRadius ? 'attack' : 'near';
    }

    world.sensors = {
      level,
      nearestDistance,
      contacts,
      baseAlarm: alarmedBaseName !== null,
      alarmedBaseName,
    };
  }
}

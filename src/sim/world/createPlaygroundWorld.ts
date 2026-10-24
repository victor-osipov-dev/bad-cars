import { wrapAngle } from '../../core/math/angle';
import { Vec2 } from '../../core/math/Vec2';
import { ENEMY_DEFINITIONS } from '../../data/enemies';
import { PROP_DEFINITIONS, type GameplayConfig, type PropPlacement } from '../../data/gameplay';
import { WEAPON_CONFIGS } from '../../data/weapons';
import type { CombatState, EnemyState } from '../combat/CombatState';
import { INVENTORY_CONFIG } from '../../data/resources';
import { createEconomyState } from '../economy/EconomyState';
import { AUTO_DRIVE_CONTROLS } from '../input/DriveCommand';
import { DEFAULT_AIM_CONTROLS } from '../input/AimCommand';
import { chunkCoordAt } from './chunkGeneration';
import { initialChunks, mergeChunkContent } from './streamChunks';
import type { ObstacleCircle } from '../vehicle/VehicleState';
import type { WorldState } from './WorldState';

/** Approximates each solid prop with a circle for cheap vehicle collisions. */
export function createObstacleCircles(
  props: readonly PropPlacement[],
): readonly ObstacleCircle[] {
  const obstacles: ObstacleCircle[] = [];
  for (const prop of props) {
    const definition = PROP_DEFINITIONS[prop.kind];
    if (!definition.solid) continue;
    obstacles.push({
      id: prop.id,
      x: prop.x,
      y: prop.y,
      radius: ((definition.width + definition.height) / 4) * prop.scale,
    });
  }
  return obstacles;
}

function createEnemies(config: GameplayConfig): EnemyState[] {
  return config.enemySpawns.map((spawn) => {
    const definition = ENEMY_DEFINITIONS[spawn.kind];
    return {
      id: spawn.id,
      kind: spawn.kind,
      spawnX: spawn.x,
      spawnY: spawn.y,
      rotation: spawn.rotation,
      radius: definition.radius,
      maxHealth: definition.maxHealth,
      position: new Vec2(spawn.x, spawn.y),
      health: definition.maxHealth,
      alive: true,
      respawnRemainingSeconds: 0,
      fireCooldownSeconds: 0,
    };
  });
}

function createCombat(config: GameplayConfig, heading: number): CombatState {
  return {
    activeSlot: 0,
    aimAngle: heading,
    aimPoint: null,
    lastReloadToken: 0,
    weapons: config.loadout.map((slot) => {
      const weapon = WEAPON_CONFIGS[slot.weaponId];
      if (!weapon) {
        throw new Error(`Unknown weapon in loadout: ${slot.weaponId}`);
      }
      return {
        weaponId: weapon.id,
        ammoInMagazine: weapon.magazineSize,
        reserveAmmo: slot.reserveAmmo,
        cooldownSeconds: 0,
        reloadRemainingSeconds: 0,
      };
    }),
  };
}

/** Builds the combat-enabled driving range around the configured spawn. */
export function createPlaygroundWorld(config: GameplayConfig): WorldState {
  const { spawn } = config.vehicle;
  const heading = wrapAngle(spawn.headingRadians);

  const chunks = initialChunks(config.world, config.worldSeed, spawn.x, spawn.y);
  const economy = createEconomyState(INVENTORY_CONFIG.cargoCapacity);
  const merged = mergeChunkContent(
    config.props,
    chunks,
    economy.depletion,
    config.spawnResourceNodes,
  );

  // The base pad doubles as the depot until real base building arrives.
  const pad = config.props.find((prop) => prop.kind === 'pad');
  const depot = { x: pad?.x ?? spawn.x, y: pad?.y ?? spawn.y };

  return {
    arena: config.world,
    chunks,
    streamingCenter: chunkCoordAt(spawn.x, spawn.y, config.world.chunkSize),
    chunkStats: {
      loadedTotal: chunks.length,
      unloadedTotal: 0,
      active: chunks.length,
    },
    props: merged.props,
    obstacles: merged.obstacles,
    resourceNodes: [...merged.resourceNodes],
    economy,
    interaction: null,
    depot,
    vehicle: {
      position: new Vec2(spawn.x, spawn.y),
      velocity: Vec2.ZERO,
      heading,
      steering: 0,
    },
    vehicleHealth: config.vehicle.durability.maxHealth,
    vehicleDestroyed: false,
    vehicleRespawnRemainingSeconds: 0,
    controls: AUTO_DRIVE_CONTROLS,
    aim: DEFAULT_AIM_CONTROLS,
    combat: createCombat(config, heading),
    enemies: createEnemies(config),
    projectiles: [],
    effects: [],
    nextProjectileId: 1,
    nextEffectId: 1,
  };
}

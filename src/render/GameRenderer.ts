import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { HALF_PI, lerpAngle } from '../core/math/angle';
import { lerp } from '../core/math/scalar';
import { EFFECT_CONFIGS, REPAIR_PROCESS, type EffectKind } from '../data/effects';
import type { GameplayConfig, PropKind } from '../data/gameplay';
import { PROP_DEFINITIONS } from '../data/gameplay';
import type { ResourceKind } from '../data/resources';
import type { ProjectileKind } from '../data/weapons';
import type {
  CombatSnapshot,
  EffectSnapshot,
  EnemySnapshot,
  ProjectileSnapshot,
  PropSnapshot,
  ResourceNodeSnapshot,
  VehicleSnapshot,
  WorldSnapshot,
} from '../sim/world/WorldState';
import { STRUCTURE_DEFINITIONS, type StructureKind } from '../data/bases';
import { TopDownOrthoCamera } from './TopDownOrthoCamera';
import {
  DEFAULT_RENDER_QUALITY,
  RENDER_QUALITY_SCALING,
  type RenderQuality,
} from './RenderQuality';
import {
  createFlatMaterial,
  createSprite,
  createTextureSet,
  createUnlitMaterial,
  GROUND_TILE_WORLD_SIZE,
  type PropTextureSet,
} from './pixelTextures';

/** Temporary render tuning; kept out of gameplay config. */
const CAMERA_VIEW_HALF_HEIGHT = 13;
const CAMERA_MIN_VIEW_HALF_WIDTH = 9;

const PROP_Z: Readonly<Record<PropKind, number>> = {
  pad: 0.1,
  crate: 0.3,
  rock: 0.4,
  wreck: 0.4,
};

const PROJECTILE_Z = 1.8;
const EFFECT_Z = 2.6;
const HARVEST_PARTICLE_Z = 2.05;
const BAR_Z = 2.2;
const LABEL_Z = 2.4;
const REPAIR_VEHICLE_Z = 2.5;
const MAX_POOLED_PER_KIND = 48;
const HARVEST_SPAWN_INTERVAL = 0.05;
const HARVEST_PARTICLE_LIFE = 0.36;
const MAX_HARVEST_PARTICLES = 28;

const PROJECTILE_SIZE: Readonly<Record<ProjectileKind, { width: number; height: number }>> = {
  bullet: { width: 0.16, height: 0.32 },
  shell: { width: 0.22, height: 0.44 },
};

interface EnemyVisual {
  readonly mesh: Mesh;
  readonly barBackground: Mesh;
  readonly barFill: Mesh;
  readonly barWidth: number;
}

/** One chunk of resource flying from a node into the truck while mining. */
interface HarvestParticle {
  readonly mesh: Mesh;
  readonly startX: number;
  readonly startY: number;
  readonly targetX: number;
  readonly targetY: number;
  age: number;
  readonly life: number;
}

function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

interface RepairTimeline {
  readonly delay: number;
  readonly travel: number;
  readonly arrival: number;
  readonly revive: number;
  readonly departure: number;
  readonly returnSeconds: number;
}

/**
 * Splits a repair effect's life into its visual phases. The turret revives at
 * `revive`, while the crew is still parked; `departure` is when it starts to
 * drive home, so the turret is always seen coming back online during repair.
 */
function repairTimeline(lifetimeSeconds: number): RepairTimeline {
  const revive = Math.max(
    0,
    lifetimeSeconds - REPAIR_PROCESS.holdSeconds - REPAIR_PROCESS.returnSeconds,
  );
  const distance = Math.hypot(REPAIR_PROCESS.depotOffsetX, REPAIR_PROCESS.depotOffsetY);
  const travel = Math.max(1e-3, distance / REPAIR_PROCESS.vehicleSpeed);
  const arrival = Math.min(revive, REPAIR_PROCESS.delaySeconds + travel);
  return {
    delay: REPAIR_PROCESS.delaySeconds,
    travel,
    arrival,
    revive,
    departure: revive + REPAIR_PROCESS.holdSeconds,
    returnSeconds: Math.max(1e-3, lifetimeSeconds - revive - REPAIR_PROCESS.holdSeconds),
  };
}

function lerpVehicle(
  from: VehicleSnapshot,
  to: VehicleSnapshot,
  alpha: number,
): VehicleSnapshot {
  const t = Math.min(1, Math.max(0, alpha));
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    heading: lerpAngle(from.heading, to.heading, t),
    width: to.width,
    height: to.height,
    speed: lerp(from.speed, to.speed, t),
    forwardSpeed: lerp(from.forwardSpeed, to.forwardSpeed, t),
    steering: lerp(from.steering, to.steering, t),
    brake: to.brake,
    handbrake: to.handbrake,
    // Durability is discrete state, not something to interpolate.
    health: to.health,
    maxHealth: to.maxHealth,
    destroyed: to.destroyed,
  };
}

export class GameRenderer {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: TopDownOrthoCamera;

  readonly #config: GameplayConfig;
  readonly #canvas: HTMLCanvasElement;
  readonly #textures: PropTextureSet;
  readonly #ground: Mesh;
  readonly #vehicle: Mesh;
  readonly #turret: Mesh;
  readonly #crosshair: Mesh;
  readonly #barBackMaterial: StandardMaterial;
  readonly #barFillMaterial: StandardMaterial;
  readonly #propMeshes = new Map<string, Mesh>();
  readonly #chunkOverlays = new Map<string, Mesh>();
  readonly #resourceMeshes = new Map<string, Mesh>();
  readonly #structureMeshes = new Map<string, Mesh>();
  readonly #baseLabelMeshes = new Map<string, Mesh>();
  readonly #biomeMaterials = new Map<string, StandardMaterial>();
  readonly #projectileMeshes = new Map<number, Mesh>();
  readonly #effectMeshes = new Map<number, Mesh>();
  readonly #repairVehicleMeshes = new Map<number, Mesh>();
  readonly #projectilePool = new Map<ProjectileKind, Mesh[]>();
  readonly #effectPool = new Map<EffectKind, Mesh[]>();
  readonly #harvestParticles: HarvestParticle[] = [];
  readonly #harvestParticlePool = new Map<ResourceKind, Mesh[]>();
  readonly #enemyVisuals = new Map<string, EnemyVisual>();
  readonly #resizeObserver: ResizeObserver;

  #harvestGlow: Mesh | null = null;

  #quality: RenderQuality = DEFAULT_RENDER_QUALITY;

  #fromVehicle: VehicleSnapshot | null = null;
  #toVehicle: VehicleSnapshot | null = null;
  #latestTick = -1;
  #harvestSpawnTimer = 0;
  #harvestNodeId: string | null = null;
  #harvestSequence = 0;

  constructor(canvas: HTMLCanvasElement, config: GameplayConfig) {
    this.#config = config;
    this.#canvas = canvas;

    this.engine = new Engine(
      canvas,
      false,
      {
        antialias: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      },
      true,
    );
    this.engine.setHardwareScalingLevel(RENDER_QUALITY_SCALING[this.#quality]);

    this.scene = new Scene(this.engine);
    // 2D world uses the conventional math orientation: +X right, +Y up.
    // A right-handed scene keeps +X on screen-right for a camera above +Z.
    this.scene.useRightHandedSystem = true;
    this.scene.clearColor = Color4.FromHexString('#171410ff');
    this.scene.imageProcessingConfiguration.isEnabled = false;
    this.scene.skipPointerMovePicking = true;

    this.camera = new TopDownOrthoCamera(this.scene, config.world, {
      viewHalfHeight: CAMERA_VIEW_HALF_HEIGHT,
      minViewHalfWidth: CAMERA_MIN_VIEW_HALF_WIDTH,
    });

    this.#textures = createTextureSet(this.scene);

    this.#ground = CreatePlane(
      'test-range-ground',
      {
        width: config.world.halfWidth * 2,
        height: config.world.halfHeight * 2,
      },
      this.scene,
    );
    this.#ground.position.z = 0;
    this.#ground.isPickable = false;
    this.#ground.alwaysSelectAsActiveMesh = true;
    // One seamless tile repeated across the world keeps pixel density constant.
    // The handcrafted test-range ground is not reused here: it contains roads
    // and pads, so tiling it would paint a grid of identical arenas.
    const groundMaterial = createUnlitMaterial(
      this.scene,
      'ground-material',
      this.#textures.groundTile,
      false,
    );
    const groundTexture = this.#textures.groundTile;
    groundTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    groundTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    groundTexture.uScale = (config.world.halfWidth * 2) / GROUND_TILE_WORLD_SIZE;
    groundTexture.vScale = (config.world.halfHeight * 2) / GROUND_TILE_WORLD_SIZE;
    this.#ground.material = groundMaterial;

    this.#vehicle = createSprite(
      this.scene,
      'player-vehicle',
      this.#textures.vehicle,
      {
        width: config.vehicle.body.width,
        height: config.vehicle.body.length,
        z: 1,
      },
    );

    this.#turret = createSprite(this.scene, 'player-turret', this.#textures.turret, {
      width: 0.85,
      height: 1.7,
      z: 1.3,
    });

    this.#crosshair = createSprite(
      this.scene,
      'player-crosshair',
      this.#textures.crosshair,
      {
        width: 1.15,
        height: 1.15,
        z: 2.4,
      },
    );
    this.#crosshair.setEnabled(false);

    this.#barBackMaterial = createFlatMaterial(this.scene, 'enemy-bar-back', '#241f17');
    this.#barFillMaterial = createFlatMaterial(this.scene, 'enemy-bar-fill', '#d0613f');

    this.camera.snapTo(config.vehicle.spawn.x, config.vehicle.spawn.y);

    this.#resizeObserver = new ResizeObserver(() => {
      this.engine.resize();
      this.layout();
    });
    this.#resizeObserver.observe(canvas);

    this.layout();
  }

  /**
   * Applies a simulation snapshot to the scene. `alpha` interpolates between
   * the previous and current render snapshots for smooth 60 Hz-independent
   * motion; `deltaSeconds` drives camera smoothing.
   */
  sync(snapshot: WorldSnapshot, alpha = 1, deltaSeconds = 0): void {
    this.#advanceInterpolation(snapshot);

    const from = this.#fromVehicle;
    const to = this.#toVehicle;
    if (from && to) {
      const display = lerpVehicle(from, to, alpha);
      this.#vehicle.position.x = display.x;
      this.#vehicle.position.y = display.y;
      // Sprite art points up (+Y); simulation heading is CCW from +X.
      this.#vehicle.rotation.z = display.heading - HALF_PI;

      this.#turret.position.x = display.x;
      this.#turret.position.y = display.y;
      this.#turret.rotation.z = snapshot.combat.aimAngle - HALF_PI;

      // Hide the wreck until it respawns instead of drawing a ghost car.
      const destroyed = to.destroyed;
      this.#vehicle.setEnabled(!destroyed);
      this.#turret.setEnabled(!destroyed);

      this.camera.follow({ x: display.x, y: display.y }, deltaSeconds);
    }

    this.#syncCrosshair(snapshot.combat);
    this.#syncChunkOverlays(snapshot);
    this.#syncProps(snapshot);
    this.#syncResourceNodes(snapshot);
    this.#syncHarvest(snapshot, deltaSeconds);
    this.#syncStructures(snapshot);
    this.#syncEnemies(snapshot.combat);
    this.#syncProjectiles(snapshot.combat);
    this.#syncEffects(snapshot.combat);
  }

  /** Converts a CSS pixel position on the canvas to world coordinates. */
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const normalizedX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const normalizedY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const view = this.camera.view;
    const center = this.camera.center;

    return {
      x: center.x + normalizedX * view.halfWidth,
      y: center.y + normalizedY * view.halfHeight,
    };
  }

  /** Converts world coordinates to CSS pixel coordinates (debug/tests). */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } | null {
    const rect = this.#canvas.getBoundingClientRect();
    const view = this.camera.view;
    if (rect.width <= 0 || view.halfWidth <= 0 || view.halfHeight <= 0) return null;

    const normalizedX = (worldX - this.camera.center.x) / view.halfWidth;
    const normalizedY = (worldY - this.camera.center.y) / view.halfHeight;

    return {
      x: rect.left + ((normalizedX + 1) / 2) * rect.width,
      y: rect.top + ((1 - normalizedY) / 2) * rect.height,
    };
  }

  #advanceInterpolation(snapshot: WorldSnapshot): void {
    if (snapshot.tick === this.#latestTick) return;

    this.#fromVehicle = this.#toVehicle ?? snapshot.vehicle;
    this.#toVehicle = snapshot.vehicle;
    this.#latestTick = snapshot.tick;
  }

  #syncCrosshair(combat: CombatSnapshot): void {
    const point = combat.aimPoint;
    this.#crosshair.setEnabled(point !== null);
    if (point) {
      this.#crosshair.position.x = point.x;
      this.#crosshair.position.y = point.y;
    }
  }

  /**
   * Draws a translucent tint per resident chunk so biome borders are readable
   * without a full terrain texture per biome.
   */
  #syncChunkOverlays(snapshot: WorldSnapshot): void {
    const seen = new Set<string>();

    for (const chunk of snapshot.minimap.chunks) {
      const key = chunk.key;
      seen.add(key);

      let mesh = this.#chunkOverlays.get(key);
      if (!mesh) {
        mesh = CreatePlane(
          `chunk-overlay-${key}`,
          { width: chunk.size, height: chunk.size },
          this.scene,
        );
        mesh.isPickable = false;
        mesh.position.z = 0.05;
        mesh.material = this.#biomeMaterial(chunk.biome);
        this.#chunkOverlays.set(key, mesh);
      }

      mesh.position.x = chunk.chunkX * chunk.size + chunk.size / 2;
      mesh.position.y = chunk.chunkY * chunk.size + chunk.size / 2;
    }

    for (const [key, mesh] of this.#chunkOverlays) {
      if (seen.has(key)) continue;
      mesh.dispose();
      this.#chunkOverlays.delete(key);
    }
  }

  #biomeMaterial(biome: string): StandardMaterial {
    const existing = this.#biomeMaterials.get(biome);
    if (existing) return existing;

    const tints: Record<string, string> = {
      wasteland: '#3a3123',
      dunes: '#6b5a33',
      scrapyard: '#2f2b25',
      ruins: '#221f1b',
    };
    const material = createFlatMaterial(
      this.scene,
      `biome-tint-${biome}`,
      tints[biome] ?? '#3a3123',
    );
    // Deliberately faint: a stronger tint would draw the chunk grid and break
    // the illusion of one continuous world.
    material.alpha = 0.07;
    material.needAlphaBlending = () => true;
    this.#biomeMaterials.set(biome, material);
    return material;
  }

  #syncProps(snapshot: WorldSnapshot): void {
    const seen = new Set<string>();

    for (const prop of snapshot.props) {
      seen.add(prop.id);
      let mesh = this.#propMeshes.get(prop.id);
      if (!mesh) {
        mesh = this.#createPropMesh(prop);
        this.#propMeshes.set(prop.id, mesh);
      }
      mesh.position.x = prop.x;
      mesh.position.y = prop.y;
      mesh.rotation.z = prop.rotation;
      const ratio = prop.maxHealth > 0 ? prop.health / prop.maxHealth : 1;
      mesh.visibility = 0.55 + 0.45 * Math.min(1, Math.max(0, ratio));
    }

    // Streaming unloads chunks, so props disappear from the snapshot. Disposing
    // their meshes keeps GPU memory flat while driving across the world.
    for (const [id, mesh] of this.#propMeshes) {
      if (seen.has(id)) continue;
      mesh.dispose();
      this.#propMeshes.delete(id);
    }
  }

  /**
   * Resource nodes belong to chunks, so they appear and disappear with
   * streaming. A node that has been mined out is hidden but kept until its
   * chunk unloads, so the sprite does not flicker as `remaining` hits zero.
   */
  #syncResourceNodes(snapshot: WorldSnapshot): void {
    const seen = new Set<string>();
    const interaction = snapshot.economy.interaction;
    const activeNodeId =
      interaction?.kind === 'harvest' && snapshot.economy.harvestProgress > 0
        ? interaction.nodeId
        : null;

    for (const node of snapshot.economy.resourceNodes) {
      seen.add(node.id);
      let mesh = this.#resourceMeshes.get(node.id);
      if (!mesh) {
        mesh = createSprite(
          this.scene,
          `resource-${node.id}`,
          this.#textures.resources[node.kind],
          { width: 1.6, height: 1.6, z: 0.35 },
        );
        this.#resourceMeshes.set(node.id, mesh);
      }

      mesh.setEnabled(node.remaining > 0);
      mesh.position.x = node.x;
      mesh.position.y = node.y;
      // Depleted nodes shrink a little so the player can read their state.
      const ratio = node.maxAmount > 0 ? node.remaining / node.maxAmount : 0;
      const harvesting = node.id === activeNodeId;
      const pulse = harvesting
        ? Math.sin(snapshot.elapsedSeconds * 24) * 0.09
        : 0;
      mesh.scaling.x = 0.75 + ratio * 0.25 + pulse;
      mesh.scaling.y = 0.75 + ratio * 0.25 - pulse;
      mesh.rotation.z = harvesting
        ? Math.sin(snapshot.elapsedSeconds * 18) * 0.07
        : 0;
    }

    for (const [id, mesh] of this.#resourceMeshes) {
      if (seen.has(id)) continue;
      mesh.dispose();
      this.#resourceMeshes.delete(id);
    }
  }

  /**
   * Mining feedback: chunks of the node fly into the truck while the player
   * holds the interact key. Purely cosmetic, driven by harvest progress in the
   * snapshot, so the simulation stays render-agnostic.
   */
  #syncHarvest(snapshot: WorldSnapshot, deltaSeconds: number): void {
    const interaction = snapshot.economy.interaction;
    const node =
      interaction?.kind === 'harvest'
        ? (snapshot.economy.resourceNodes.find(
            (entry) => entry.id === interaction.nodeId,
          ) ?? null)
        : null;

    const active =
      node !== null &&
      node.remaining > 0 &&
      snapshot.economy.harvestProgress > 0;

    if (!active) {
      this.#harvestSpawnTimer = 0;
      this.#harvestNodeId = null;
      this.#harvestGlow?.setEnabled(false);
    } else {
      if (this.#harvestNodeId !== node.id) {
        this.#harvestNodeId = node.id;
        this.#harvestSpawnTimer = 0;
      }
      if (!this.#harvestGlow) {
        this.#harvestGlow = createSprite(
          this.scene,
          'harvest-glow',
          this.#textures.harvestGlow,
          {
            width: 3.4,
            height: 3.4,
            z: 0.28,
            alphaMode: 'blend',
          },
        );
      }
      this.#harvestGlow.setEnabled(true);
      this.#harvestGlow.position.x = node.x;
      this.#harvestGlow.position.y = node.y;
      const glowScale = 1 + Math.sin(snapshot.elapsedSeconds * 9) * 0.09;
      this.#harvestGlow.scaling.x = glowScale;
      this.#harvestGlow.scaling.y = glowScale;
      this.#harvestGlow.visibility = 0.7;

      this.#harvestSpawnTimer += deltaSeconds;
      while (this.#harvestSpawnTimer >= HARVEST_SPAWN_INTERVAL) {
        this.#harvestSpawnTimer -= HARVEST_SPAWN_INTERVAL;
        this.#spawnHarvestParticle(node, snapshot.vehicle);
      }
    }

    for (let index = this.#harvestParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.#harvestParticles[index];
      if (!particle) continue;
      particle.age += deltaSeconds;
      const t = particle.age / particle.life;
      if (t >= 1) {
        this.#releaseHarvestParticle(particle.mesh);
        this.#harvestParticles.splice(index, 1);
        continue;
      }

      const ease = t * t * (3 - 2 * t);
      const dx = particle.targetX - particle.startX;
      const dy = particle.targetY - particle.startY;
      const length = Math.hypot(dx, dy) || 1;
      // A small sideways arc makes the stream read as movement, not a line.
      const arc = Math.sin(Math.PI * t) * 0.32;
      particle.mesh.position.x =
        lerp(particle.startX, particle.targetX, ease) - (dy / length) * arc;
      particle.mesh.position.y =
        lerp(particle.startY, particle.targetY, ease) + (dx / length) * arc;
      particle.mesh.rotation.z = t * 6;
      const scale = 1 - t * 0.6;
      particle.mesh.scaling.x = scale;
      particle.mesh.scaling.y = scale;
      particle.mesh.visibility = Math.min(1, (1 - t) * 1.8);
    }
  }

  #spawnHarvestParticle(
    node: ResourceNodeSnapshot,
    vehicle: VehicleSnapshot,
  ): void {
    if (this.#harvestParticles.length >= MAX_HARVEST_PARTICLES) return;
    const sequence = this.#harvestSequence;
    this.#harvestSequence += 1;

    // Deterministic golden-angle scatter: no Math.random in the renderer.
    const angle = sequence * 2.399963;
    const radius = 0.2 + ((sequence * 0.618034) % 1) * 0.55;
    const startX = node.x + Math.cos(angle) * radius;
    const startY = node.y + Math.sin(angle) * radius;
    const life = HARVEST_PARTICLE_LIFE + ((sequence * 0.37) % 1) * 0.12;

    const mesh = this.#acquireHarvestParticle(node.kind, sequence);
    mesh.position.x = startX;
    mesh.position.y = startY;
    mesh.rotation.z = 0;
    mesh.visibility = 1;
    mesh.scaling.x = 1;
    mesh.scaling.y = 1;

    this.#harvestParticles.push({
      mesh,
      startX,
      startY,
      targetX: vehicle.x,
      targetY: vehicle.y,
      age: 0,
      life,
    });
  }

  #acquireHarvestParticle(kind: ResourceKind, sequence: number): Mesh {
    const pool = this.#harvestParticlePool.get(kind) ?? [];
    const pooled = pool.pop();
    if (pooled) {
      pooled.setEnabled(true);
      return pooled;
    }
    const mesh = createSprite(
      this.scene,
      `harvest-${kind}-${sequence}`,
      this.#textures.harvestSparks[kind],
      {
        width: 0.72,
        height: 0.72,
        z: HARVEST_PARTICLE_Z,
        alphaMode: 'blend',
      },
    );
    mesh.metadata = { harvestKind: kind };
    return mesh;
  }

  #releaseHarvestParticle(mesh: Mesh): void {
    mesh.setEnabled(false);
    const kind = (mesh.metadata as { harvestKind?: ResourceKind } | null)
      ?.harvestKind;
    if (!kind) {
      this.#disposeTransient(mesh);
      return;
    }
    const pool = this.#harvestParticlePool.get(kind) ?? [];
    if (pool.length >= MAX_POOLED_PER_KIND) {
      this.#disposeTransient(mesh);
      return;
    }
    pool.push(mesh);
    this.#harvestParticlePool.set(kind, pool);
  }

  /** Base structures are permanent once built; sync positions and add new ones. */
  #syncStructures(snapshot: WorldSnapshot): void {
    const seen = new Set<string>();
    const labelIds = new Set<string>();

    for (const base of snapshot.baseState.bases) {
      labelIds.add(base.id);
      let label = this.#baseLabelMeshes.get(base.id);
      if (!label) {
        label = createSprite(
          this.scene,
          `base-label-${base.id}`,
          this.#textures.baseLabel,
          { width: 5.2, height: 0.9, z: LABEL_Z },
        );
        this.#baseLabelMeshes.set(base.id, label);
      }
      label.position.x = base.x;
      label.position.y = base.y + 3.1;

      for (const structure of base.structures) {
        seen.add(structure.id);
        let mesh = this.#structureMeshes.get(structure.id);
        if (!mesh) {
          const kind = structure.kind as StructureKind;
          const definition = STRUCTURE_DEFINITIONS[kind];
          mesh = createSprite(
            this.scene,
            `structure-${structure.id}`,
            this.#textures.structures[kind],
            { width: definition.width, height: definition.height, z: 0.6 },
          );
          this.#structureMeshes.set(structure.id, mesh);
        }
        mesh.position.x = structure.x;
        mesh.position.y = structure.y;
        // Turrets aim independently; sprite art points up (+Y).
        if (structure.kind === 'turret') {
          mesh.rotation.z = structure.aimAngle - Math.PI / 2;
        }
      }
    }

    for (const [id, mesh] of this.#structureMeshes) {
      if (seen.has(id)) continue;
      mesh.dispose();
      this.#structureMeshes.delete(id);
    }

    for (const [id, mesh] of this.#baseLabelMeshes) {
      if (labelIds.has(id)) continue;
      mesh.dispose();
      this.#baseLabelMeshes.delete(id);
    }
  }

  #syncEnemies(combat: CombatSnapshot): void {
    const seen = new Set<string>();

    for (const enemy of combat.enemies) {
      seen.add(enemy.id);
      let visual = this.#enemyVisuals.get(enemy.id);
      if (!visual) {
        visual = this.#createEnemyVisual(enemy);
        this.#enemyVisuals.set(enemy.id, visual);
      }

      visual.mesh.setEnabled(enemy.alive);
      visual.mesh.position.x = enemy.x;
      visual.mesh.position.y = enemy.y;
      visual.mesh.rotation.z = enemy.rotation;

      const ratio = enemy.maxHealth > 0 ? enemy.health / enemy.maxHealth : 0;
      const showBar = enemy.alive && ratio < 1;
      visual.barBackground.setEnabled(showBar);
      visual.barFill.setEnabled(showBar);

      if (showBar) {
        const barY = enemy.y + enemy.radius + 0.45;
        visual.barBackground.position.x = enemy.x;
        visual.barBackground.position.y = barY;
        visual.barFill.position.x = enemy.x - visual.barWidth / 2 + (visual.barWidth * ratio) / 2;
        visual.barFill.position.y = barY;
        visual.barFill.scaling.x = Math.max(0.001, ratio);
      }
    }

    for (const [id, visual] of this.#enemyVisuals) {
      if (seen.has(id)) continue;
      visual.mesh.dispose();
      visual.barBackground.dispose();
      visual.barFill.dispose();
      this.#enemyVisuals.delete(id);
    }
  }

  #syncProjectiles(combat: CombatSnapshot): void {
    const seen = new Set<number>();

    for (const projectile of combat.projectiles) {
      seen.add(projectile.id);
      let mesh = this.#projectileMeshes.get(projectile.id);
      if (!mesh) {
        mesh = this.#acquireProjectile(projectile);
        this.#projectileMeshes.set(projectile.id, mesh);
      }
      mesh.position.x = projectile.x;
      mesh.position.y = projectile.y;
      mesh.rotation.z = projectile.angle - HALF_PI;
    }

    for (const [id, mesh] of this.#projectileMeshes) {
      if (seen.has(id)) continue;
      this.#releaseTransient(mesh, this.#projectilePool);
      this.#projectileMeshes.delete(id);
    }
  }

  #syncEffects(combat: CombatSnapshot): void {
    const seen = new Set<number>();

    for (const effect of combat.effects) {
      seen.add(effect.id);
      let mesh = this.#effectMeshes.get(effect.id);
      if (!mesh) {
        mesh = this.#acquireEffect(effect);
        this.#effectMeshes.set(effect.id, mesh);
      }

      const life = effect.lifetimeSeconds > 0 ? effect.ageSeconds / effect.lifetimeSeconds : 1;
      const progress = Math.min(1, Math.max(0, life));
      const scale = 0.75 + progress * 0.55;
      mesh.position.x = effect.x;
      mesh.position.y = effect.y;
      if (effect.kind === 'repair') {
        const timing = repairTimeline(effect.lifetimeSeconds);
        // The drone only appears while the crew is actually working.
        const working =
          effect.ageSeconds >= timing.arrival && effect.ageSeconds <= timing.revive;
        const pulse = 0.9 + Math.sin(effect.ageSeconds * 9) * 0.12;
        mesh.rotation.z = effect.ageSeconds * 1.8;
        mesh.scaling.x = pulse;
        mesh.scaling.y = pulse;
        mesh.visibility = working ? 1 : 0;
        this.#syncRepairVehicle(effect, timing);
      } else {
        mesh.rotation.z = effect.rotation - HALF_PI;
        mesh.scaling.x = scale;
        mesh.scaling.y = scale;
        mesh.visibility = Math.max(0, 1 - progress);
      }
    }

    for (const [id, mesh] of this.#effectMeshes) {
      if (seen.has(id)) continue;
      this.#releaseTransient(mesh, this.#effectPool);
      this.#effectMeshes.delete(id);
    }

    for (const [id, mesh] of this.#repairVehicleMeshes) {
      if (seen.has(id)) continue;
      mesh.dispose();
      this.#repairVehicleMeshes.delete(id);
    }
  }

  /**
   * Drives the maintenance crew through its phases: wait at the depot, drive
   * to the turret, work while the turret is being restored, then drive home.
   */
  #syncRepairVehicle(effect: EffectSnapshot, timing: RepairTimeline): void {
    let mesh = this.#repairVehicleMeshes.get(effect.id);
    if (!mesh) {
      mesh = createSprite(
        this.scene,
        `repair-vehicle-${effect.id}`,
        this.#textures.repairVehicle,
        { width: 2.8, height: 1.9, z: REPAIR_VEHICLE_Z },
      );
      this.#repairVehicleMeshes.set(effect.id, mesh);
    }

    const depotX = effect.x + REPAIR_PROCESS.depotOffsetX;
    const depotY = effect.y + REPAIR_PROCESS.depotOffsetY;
    const toTurret = Math.atan2(effect.y - depotY, effect.x - depotX);
    const toDepot = Math.atan2(depotY - effect.y, depotX - effect.x);
    const age = effect.ageSeconds;

    let x = depotX;
    let y = depotY;
    let heading = toTurret;
    let visible = true;

    if (age < timing.delay) {
      // The crew has not departed yet; keep it out of sight at the depot.
      visible = false;
    } else if (age < timing.arrival) {
      const t = easeInOut((age - timing.delay) / Math.max(1e-3, timing.travel));
      x = depotX + (effect.x - depotX) * t;
      y = depotY + (effect.y - depotY) * t;
      heading = toTurret;
    } else if (age <= timing.departure) {
      // Repair work finished and the turret is back online; the crew lingers
      // for a moment before heading home.
      x = effect.x;
      y = effect.y;
      heading = toTurret;
    } else {
      const t = easeInOut((age - timing.departure) / timing.returnSeconds);
      x = effect.x + (depotX - effect.x) * t;
      y = effect.y + (depotY - effect.y) * t;
      heading = toDepot;
    }

    mesh.setEnabled(visible);
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.rotation.z = heading - HALF_PI;
  }

  #createPropMesh(prop: PropSnapshot): Mesh {
    const definition = PROP_DEFINITIONS[prop.kind];
    const mesh = createSprite(
      this.scene,
      `prop-${prop.id}`,
      this.#textures.props[prop.kind],
      {
        width: definition.width * prop.scale,
        height: definition.height * prop.scale,
        z: PROP_Z[prop.kind],
      },
    );
    mesh.position.x = prop.x;
    mesh.position.y = prop.y;
    mesh.rotation.z = prop.rotation;
    return mesh;
  }

  #createEnemyVisual(enemy: EnemySnapshot): EnemyVisual {
    const mesh = createSprite(
      this.scene,
      `enemy-${enemy.id}`,
      this.#textures.enemies[enemy.kind],
      {
        width: enemy.radius * 2.1,
        height: enemy.radius * 2.5,
        z: 0.8,
      },
    );
    mesh.position.x = enemy.x;
    mesh.position.y = enemy.y;
    mesh.rotation.z = enemy.rotation;

    const barWidth = enemy.radius * 1.9;
    const barHeight = 0.16;
    const barY = enemy.y + enemy.radius + 0.45;

    const barBackground = CreatePlane(
      `enemy-${enemy.id}-bar-back`,
      { width: barWidth, height: barHeight },
      this.scene,
    );
    barBackground.material = this.#barBackMaterial;
    barBackground.position.set(enemy.x, barY, BAR_Z);
    barBackground.isPickable = false;
    barBackground.alwaysSelectAsActiveMesh = true;

    const barFill = CreatePlane(
      `enemy-${enemy.id}-bar-fill`,
      { width: barWidth, height: barHeight * 0.62 },
      this.scene,
    );
    barFill.material = this.#barFillMaterial;
    barFill.position.set(enemy.x, barY, BAR_Z + 0.01);
    barFill.isPickable = false;
    barFill.alwaysSelectAsActiveMesh = true;

    return { mesh, barBackground, barFill, barWidth };
  }

  #createProjectileMesh(projectile: ProjectileSnapshot): Mesh {
    const size = PROJECTILE_SIZE[projectile.kind];
    const mesh = createSprite(
      this.scene,
      `projectile-${projectile.id}`,
      this.#textures.projectiles[projectile.kind],
      {
        width: size.width,
        height: size.height,
        z: PROJECTILE_Z,
      },
    );
    mesh.metadata = { transientKind: projectile.kind };
    return mesh;
  }

  #createEffectMesh(effect: EffectSnapshot): Mesh {
    const size = EFFECT_CONFIGS[effect.kind].scale;
    const mesh = createSprite(
      this.scene,
      `effect-${effect.id}`,
      this.#textures.effects[effect.kind],
      {
        width: size,
        height: size,
        z: EFFECT_Z,
        alphaMode: 'blend',
      },
    );
    mesh.metadata = { transientKind: effect.kind };
    return mesh;
  }

  #acquireProjectile(projectile: ProjectileSnapshot): Mesh {
    const pool = this.#projectilePool.get(projectile.kind) ?? [];
    const mesh = pool.pop();
    if (!mesh) return this.#createProjectileMesh(projectile);
    mesh.setEnabled(true);
    mesh.visibility = 1;
    mesh.scaling.x = 1;
    mesh.scaling.y = 1;
    return mesh;
  }

  #acquireEffect(effect: EffectSnapshot): Mesh {
    const pool = this.#effectPool.get(effect.kind) ?? [];
    const mesh = pool.pop();
    if (!mesh) return this.#createEffectMesh(effect);
    mesh.setEnabled(true);
    mesh.visibility = 1;
    mesh.scaling.x = 1;
    mesh.scaling.y = 1;
    return mesh;
  }

  #releaseTransient<K extends string>(
    mesh: Mesh,
    pool: Map<K, Mesh[]>,
  ): void {
    const kind = (mesh.metadata as { transientKind?: K } | null)?.transientKind;
    if (!kind) {
      this.#disposeTransient(mesh);
      return;
    }
    mesh.setEnabled(false);
    const bucket = pool.get(kind) ?? [];
    if (bucket.length >= MAX_POOLED_PER_KIND) {
      this.#disposeTransient(mesh);
      return;
    }
    bucket.push(mesh);
    pool.set(kind, bucket);
  }

  #disposePool<K extends string>(pool: Map<K, Mesh[]>): void {
    for (const meshes of pool.values()) {
      for (const mesh of meshes) this.#disposeTransient(mesh);
    }
    pool.clear();
  }

  #disposeTransient(mesh: Mesh): void {
    const material = mesh.material;
    mesh.dispose();
    material?.dispose(false, false);
  }

  layout(): void {
    this.camera.fit(this.engine.getRenderWidth(), this.engine.getRenderHeight());
  }

  setQuality(quality: RenderQuality): void {
    if (this.#quality === quality) return;
    this.#quality = quality;
    this.engine.setHardwareScalingLevel(RENDER_QUALITY_SCALING[quality]);
    this.layout();
  }

  get quality(): RenderQuality {
    return this.#quality;
  }

  /** Mesh accounting for the frame-budget HUD and e2e assertions. */
  get transientStats(): {
    quality: RenderQuality;
    activeProjectiles: number;
    activeEffects: number;
    activeHarvestParticles: number;
    pooledProjectiles: number;
    pooledEffects: number;
  } {
    const pooled = <K extends string>(pool: Map<K, Mesh[]>): number =>
      [...pool.values()].reduce((total, meshes) => total + meshes.length, 0);
    return {
      quality: this.#quality,
      activeProjectiles: this.#projectileMeshes.size,
      activeEffects: this.#effectMeshes.size,
      activeHarvestParticles: this.#harvestParticles.length,
      pooledProjectiles: pooled(this.#projectilePool),
      pooledEffects: pooled(this.#effectPool),
    };
  }

  render(): void {
    this.scene.render();
  }

  dispose(): void {
    this.#resizeObserver.disconnect();
    this.#vehicle.dispose();
    this.#turret.dispose();
    this.#crosshair.dispose();
    this.#ground.dispose();
    for (const mesh of this.#propMeshes.values()) mesh.dispose();
    this.#propMeshes.clear();
    for (const mesh of this.#baseLabelMeshes.values()) mesh.dispose();
    this.#baseLabelMeshes.clear();
    for (const visual of this.#enemyVisuals.values()) {
      visual.mesh.dispose();
      visual.barBackground.dispose();
      visual.barFill.dispose();
    }
    this.#enemyVisuals.clear();
    for (const mesh of this.#projectileMeshes.values()) this.#disposeTransient(mesh);
    this.#projectileMeshes.clear();
    this.#disposePool(this.#projectilePool);
    for (const mesh of this.#effectMeshes.values()) this.#disposeTransient(mesh);
    this.#effectMeshes.clear();
    for (const mesh of this.#repairVehicleMeshes.values()) mesh.dispose();
    this.#repairVehicleMeshes.clear();
    this.#disposePool(this.#effectPool);
    for (const particle of this.#harvestParticles) {
      this.#disposeTransient(particle.mesh);
    }
    this.#harvestParticles.length = 0;
    this.#harvestGlow?.dispose();
    this.#harvestGlow = null;
    this.#disposePool(this.#harvestParticlePool);
    this.#barBackMaterial.dispose();
    this.#barFillMaterial.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  get config(): GameplayConfig {
    return this.#config;
  }
}

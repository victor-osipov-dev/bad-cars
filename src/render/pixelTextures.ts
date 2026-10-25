import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { ResourceKind } from '../data/resources';
import type { StructureKind } from '../data/bases';
import { SeededRandom } from '../core/math/rng';
import type { EnemyKind } from '../data/enemies';
import type { EffectKind } from '../data/effects';
import type { PropKind } from '../data/gameplay';
import type { ProjectileKind } from '../data/weapons';
import { PALETTE } from './palette';

type TextureContext = ReturnType<DynamicTexture['getContext']>;

const GROUND_WIDTH_PX = 512;
const GROUND_HEIGHT_PX = 320;

function createPixelTexture(
  scene: Scene,
  name: string,
  width: number,
  height: number,
  draw: (ctx: TextureContext) => void,
  hasAlpha: boolean,
): DynamicTexture {
  const texture = new DynamicTexture(
    name,
    { width, height },
    scene,
    false,
    Texture.NEAREST_SAMPLINGMODE,
  );

  texture.hasAlpha = hasAlpha;
  // Babylon's plane UVs and canvas row order disagree vertically; flip the
  // texture coordinates so authored pixel art keeps its top at world +Y.
  texture.vScale = -1;
  texture.vOffset = 1;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 1;

  const ctx = texture.getContext();
  ctx.clearRect(0, 0, width, height);
  draw(ctx);
  texture.update(false);

  return texture;
}

function fill(ctx: TextureContext, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function fillCircle(
  ctx: TextureContext,
  centerX: number,
  centerY: number,
  radius: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) {
        ctx.fillRect(centerX + x, centerY + y, 1, 1);
      }
    }
  }
}

/** Screen/world size of one open-world ground tile, world units. */
export const GROUND_TILE_WORLD_SIZE = 10;

const GROUND_TILE_PX = 128;

/**
 * Seamless wasteland tile for the open world.
 *
 * Everything is drawn with wrap-around copies so the texture tiles without
 * visible seams. Unlike the handcrafted test-range ground it contains no
 * roads, pads or borders, so repeating it across 640x640 units does not paint
 * a grid of identical arenas.
 */
function createOpenWorldGroundTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'ground-wasteland-tile',
    GROUND_TILE_PX,
    GROUND_TILE_PX,
    (ctx) => {
      const rng = new SeededRandom(0x0be5_0007);
      const size = GROUND_TILE_PX;

      fill(ctx, 0, 0, size, size, PALETTE.sand);

      /** Draws a rectangle plus the wrapped copies needed for seamlessness. */
      const fillWrapped = (
        x: number,
        y: number,
        w: number,
        h: number,
        color: string,
      ): void => {
        for (const offsetX of [0, -size, size]) {
          for (const offsetY of [0, -size, size]) {
            fill(ctx, x + offsetX, y + offsetY, w, h, color);
          }
        }
      };

      const patchColors = [
        PALETTE.sandDark,
        PALETTE.sandLight,
        PALETTE.sandHighlight,
        '#332c22',
      ];
      for (let i = 0; i < 520; i += 1) {
        fillWrapped(
          rng.int(0, size - 1),
          rng.int(0, size - 1),
          rng.int(1, 5),
          rng.int(1, 4),
          rng.pick(patchColors),
        );
      }

      // Cracks and gravel specks, also wrapped.
      for (let i = 0; i < 90; i += 1) {
        const cx = rng.int(0, size - 1);
        const cy = rng.int(0, size - 1);
        const radius = rng.int(2, 6);
        for (let y = -radius; y <= radius; y += 1) {
          for (let x = -radius; x <= radius; x += 1) {
            if (x * x + y * y > radius * radius) continue;
            if (!rng.chance(0.4)) continue;
            fillWrapped(cx + x, cy + y, 1, 1, PALETTE.sandDark);
          }
        }
      }
    },
    false,
  );
}

function createGroundTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'ground-sand',
    GROUND_WIDTH_PX,
    GROUND_HEIGHT_PX,
    (ctx) => {
      const rng = new SeededRandom(0x51a7_0001);

      fill(ctx, 0, 0, GROUND_WIDTH_PX, GROUND_HEIGHT_PX, PALETTE.sand);

      // Coarse pixel noise patches.
      const patchColors = [
        PALETTE.sandDark,
        PALETTE.sandLight,
        PALETTE.sandHighlight,
        '#332c22',
      ];
      for (let i = 0; i < 1600; i += 1) {
        const x = rng.int(0, GROUND_WIDTH_PX - 1);
        const y = rng.int(0, GROUND_HEIGHT_PX - 1);
        const w = rng.int(1, 7);
        const h = rng.int(1, 5);
        fill(ctx, x, y, w, h, rng.pick(patchColors));
      }

      // Dark stains and old burn marks.
      for (let i = 0; i < 36; i += 1) {
        const cx = rng.int(10, GROUND_WIDTH_PX - 10);
        const cy = rng.int(10, GROUND_HEIGHT_PX - 10);
        const radius = rng.int(4, 16);
        for (let y = -radius; y <= radius; y += 1) {
          for (let x = -radius; x <= radius; x += 1) {
            if (x * x + y * y <= radius * radius && rng.chance(0.55)) {
              fill(ctx, cx + x, cy + y, 1, 1, PALETTE.sandDark);
            }
          }
        }
      }

      // Two wavy tyre tracks running left to right.
      const drawTrack = (offsetY: number): void => {
        for (let x = 0; x < GROUND_WIDTH_PX; x += 3) {
          const y = offsetY + Math.round(Math.sin(x * 0.0275) * 14 + Math.sin(x * 0.0085) * 10);
          fill(ctx, x, y, 2, 3, PALETTE.track);
          if (x % 12 === 0) {
            fill(ctx, x, y + 3, 1, 1, PALETTE.sandDark);
          }
        }
      };
      drawTrack(160);
      drawTrack(188);

      // Subtle arena border, inside the ground plane.
      fill(ctx, 0, 0, GROUND_WIDTH_PX, 5, PALETTE.borderDark);
      fill(ctx, 0, GROUND_HEIGHT_PX - 5, GROUND_WIDTH_PX, 5, PALETTE.borderDark);
      fill(ctx, 0, 0, 5, GROUND_HEIGHT_PX, PALETTE.borderDark);
      fill(ctx, GROUND_WIDTH_PX - 5, 0, 5, GROUND_HEIGHT_PX, PALETTE.borderDark);
      fill(ctx, 5, 5, GROUND_WIDTH_PX - 10, 2, PALETTE.border);
      fill(ctx, 5, GROUND_HEIGHT_PX - 7, GROUND_WIDTH_PX - 10, 2, PALETTE.border);
      fill(ctx, 5, 5, 2, GROUND_HEIGHT_PX - 10, PALETTE.border);
      fill(ctx, GROUND_WIDTH_PX - 7, 5, 2, GROUND_HEIGHT_PX - 10, PALETTE.border);

      // Faded corner stencils.
      const stencil = (x: number, y: number): void => {
        fill(ctx, x, y, 28, 3, PALETTE.border);
        fill(ctx, x, y, 3, 28, PALETTE.border);
      };
      stencil(20, 20);
      stencil(GROUND_WIDTH_PX - 48, 20);
      stencil(20, GROUND_HEIGHT_PX - 48);
      stencil(GROUND_WIDTH_PX - 48, GROUND_HEIGHT_PX - 48);
    },
    false,
  );
}

function createVehicleTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'vehicle-buggy',
    20,
    28,
    (ctx) => {
      // Canvas is 20x28, front of the car points up.

      // Wheels.
      fill(ctx, 1, 7, 4, 6, PALETTE.tire);
      fill(ctx, 15, 7, 4, 6, PALETTE.tire);
      fill(ctx, 1, 18, 4, 6, PALETTE.tire);
      fill(ctx, 15, 18, 4, 6, PALETTE.tire);
      fill(ctx, 2, 8, 2, 4, PALETTE.tireHighlight);
      fill(ctx, 16, 8, 2, 4, PALETTE.tireHighlight);
      fill(ctx, 2, 19, 2, 4, PALETTE.tireHighlight);
      fill(ctx, 16, 19, 2, 4, PALETTE.tireHighlight);

      // Chassis.
      fill(ctx, 4, 4, 12, 21, PALETTE.rustDark);
      fill(ctx, 4, 4, 12, 2, PALETTE.rustLight);
      fill(ctx, 5, 6, 10, 3, PALETTE.rust);
      fill(ctx, 5, 9, 10, 14, PALETTE.rust);
      fill(ctx, 6, 10, 3, 12, PALETTE.rustLight);
      fill(ctx, 12, 10, 2, 12, PALETTE.rustDark);

      // Front bumper and headlights.
      fill(ctx, 4, 2, 12, 2, PALETTE.metal);
      fill(ctx, 5, 1, 3, 1, PALETTE.metalLight);
      fill(ctx, 12, 1, 3, 1, PALETTE.metalLight);
      fill(ctx, 5, 3, 3, 2, PALETTE.headlight);
      fill(ctx, 12, 3, 3, 2, PALETTE.headlight);
      fill(ctx, 8, 2, 4, 2, PALETTE.metal);

      // Windshield and cabin.
      fill(ctx, 6, 8, 8, 5, PALETTE.glass);
      fill(ctx, 7, 9, 3, 3, PALETTE.glassLight);
      fill(ctx, 4, 8, 2, 6, PALETTE.metal);
      fill(ctx, 14, 8, 2, 6, PALETTE.metal);

      // Roof rack with spare fuel can.
      fill(ctx, 6, 14, 8, 2, PALETTE.metal);
      fill(ctx, 7, 15, 4, 4, PALETTE.woodDark);
      fill(ctx, 8, 16, 2, 2, PALETTE.hazard);
      fill(ctx, 13, 16, 1, 3, PALETTE.metalLight);

      // Turret and forward gun.
      fill(ctx, 8, 20, 4, 4, PALETTE.metal);
      fill(ctx, 9, 19, 2, 1, PALETTE.metalLight);
      fill(ctx, 9, 13, 2, 7, PALETTE.metalLight);
      fill(ctx, 9, 9, 2, 4, PALETTE.tire);
      fill(ctx, 8, 18, 4, 1, PALETTE.metalLight);

      // Rear bumper and lights.
      fill(ctx, 4, 25, 12, 2, PALETTE.metal);
      fill(ctx, 5, 24, 3, 2, PALETTE.taillight);
      fill(ctx, 12, 24, 3, 2, PALETTE.taillight);
      fill(ctx, 9, 23, 2, 1, PALETTE.metalLight);

      // Rust speckles.
      fill(ctx, 6, 12, 1, 1, PALETTE.rustDark);
      fill(ctx, 13, 11, 1, 2, PALETTE.rustDark);
      fill(ctx, 5, 22, 1, 1, PALETTE.rustDark);
      fill(ctx, 14, 21, 1, 1, PALETTE.rustDark);
    },
    true,
  );
}

function createRockTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'prop-rock',
    20,
    18,
    (ctx) => {
      const rows: readonly (readonly [number, number, string])[] = [
        [6, 8, PALETTE.rock],
        [4, 12, PALETTE.rock],
        [3, 14, PALETTE.rock],
        [2, 16, PALETTE.rock],
        [1, 18, PALETTE.rock],
        [1, 18, PALETTE.rockDark],
        [2, 16, PALETTE.rockDark],
        [4, 12, PALETTE.rockDark],
        [7, 6, PALETTE.rockDark],
      ];

      rows.forEach(([x, w, color], index) => {
        fill(ctx, x, index + 3, w, 2, color);
      });

      fill(ctx, 5, 4, 5, 2, PALETTE.rockLight);
      fill(ctx, 4, 6, 3, 2, PALETTE.rockLight);
      fill(ctx, 8, 3, 4, 1, PALETTE.rockHighlight);
      fill(ctx, 7, 5, 2, 2, PALETTE.rockHighlight);
      fill(ctx, 11, 7, 3, 1, PALETTE.rockHighlight);

      // Cracks.
      fill(ctx, 9, 6, 1, 3, PALETTE.rockDark);
      fill(ctx, 10, 9, 2, 1, PALETTE.rockDark);
      fill(ctx, 14, 8, 1, 3, PALETTE.rockDark);
      fill(ctx, 5, 10, 2, 1, PALETTE.rockDark);

      // Ground contact shadow.
      fill(ctx, 3, 15, 14, 1, PALETTE.borderDark);
      fill(ctx, 5, 16, 10, 1, PALETTE.borderDark);
    },
    true,
  );
}

function createWreckTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'prop-wreck',
    30,
    20,
    (ctx) => {
      // Burnt-out car, pointing right.
      fill(ctx, 2, 6, 3, 4, PALETTE.tire);
      fill(ctx, 2, 13, 3, 4, PALETTE.tire);
      fill(ctx, 24, 6, 3, 4, PALETTE.tire);
      fill(ctx, 24, 13, 3, 4, PALETTE.tire);

      fill(ctx, 4, 5, 21, 13, PALETTE.rustDark);
      fill(ctx, 7, 4, 15, 2, PALETTE.rust);
      fill(ctx, 6, 7, 17, 9, PALETTE.rust);
      fill(ctx, 9, 8, 10, 7, PALETTE.rustDark);
      fill(ctx, 6, 7, 3, 8, PALETTE.rustLight);
      fill(ctx, 22, 8, 3, 6, PALETTE.metal);

      // Barely visible shattered glass.
      fill(ctx, 12, 8, 6, 1, PALETTE.glass);
      fill(ctx, 14, 9, 3, 1, PALETTE.glass);
      fill(ctx, 11, 10, 2, 1, PALETTE.glassLight);
      fill(ctx, 17, 10, 1, 1, PALETTE.glassLight);

      // Charred body damage and missing panels.
      fill(ctx, 8, 12, 4, 3, PALETTE.tire);
      fill(ctx, 16, 11, 3, 4, PALETTE.tire);
      fill(ctx, 10, 14, 7, 2, PALETTE.rustDark);
      fill(ctx, 4, 16, 20, 1, PALETTE.borderDark);
      fill(ctx, 26, 9, 2, 1, PALETTE.metalLight);
      fill(ctx, 1, 9, 2, 2, PALETTE.metal);
    },
    true,
  );
}

function createCrateTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'prop-crate',
    14,
    14,
    (ctx) => {
      fill(ctx, 1, 1, 12, 12, PALETTE.woodDark);
      fill(ctx, 2, 2, 10, 10, PALETTE.wood);
      fill(ctx, 2, 2, 10, 1, PALETTE.woodLight);
      fill(ctx, 2, 11, 10, 1, PALETTE.woodDark);
      fill(ctx, 2, 5, 10, 1, PALETTE.woodDark);
      fill(ctx, 2, 8, 10, 1, PALETTE.woodDark);
      fill(ctx, 3, 3, 1, 8, PALETTE.woodLight);
      fill(ctx, 10, 3, 1, 8, PALETTE.woodDark);
      fill(ctx, 6, 3, 2, 8, PALETTE.metal);
      fill(ctx, 6, 6, 2, 1, PALETTE.metalLight);
      fill(ctx, 6, 9, 2, 1, PALETTE.metalLight);
      fill(ctx, 1, 1, 1, 1, PALETTE.metal);
      fill(ctx, 12, 1, 1, 1, PALETTE.metal);
      fill(ctx, 1, 12, 1, 1, PALETTE.metal);
      fill(ctx, 12, 12, 1, 1, PALETTE.metal);
    },
    true,
  );
}

function createScrapNodeTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'resource-scrap',
    16,
    16,
    (ctx) => {
      // A heap of salvaged plate and rod.
      fill(ctx, 1, 9, 14, 6, PALETTE.tire);
      fill(ctx, 2, 8, 12, 5, PALETTE.metal);
      fill(ctx, 3, 7, 9, 4, PALETTE.metalLight);
      fill(ctx, 4, 6, 6, 3, PALETTE.metal);
      fill(ctx, 5, 5, 4, 2, PALETTE.metalLight);
      fill(ctx, 2, 12, 12, 1, PALETTE.tire);
      fill(ctx, 11, 4, 2, 5, PALETTE.rust);
      fill(ctx, 12, 3, 1, 3, PALETTE.rust);
      fill(ctx, 3, 3, 1, 3, PALETTE.metal);
      fill(ctx, 4, 2, 2, 2, PALETTE.metalLight);
    },
    true,
  );
}

function createFuelNodeTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'resource-fuel',
    16,
    16,
    (ctx) => {
      // Rusty fuel drum with a hazard stripe.
      fill(ctx, 3, 3, 10, 12, PALETTE.tire);
      fill(ctx, 4, 4, 8, 10, PALETTE.rust);
      fill(ctx, 4, 4, 8, 1, PALETTE.rustLight);
      fill(ctx, 4, 6, 8, 2, '#e0b23c');
      fill(ctx, 5, 6, 2, 2, '#26241c');
      fill(ctx, 9, 6, 2, 2, '#26241c');
      fill(ctx, 4, 11, 8, 1, PALETTE.tire);
      fill(ctx, 6, 2, 4, 1, PALETTE.metal);
    },
    true,
  );
}

function createWaterNodeTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'resource-water',
    16,
    16,
    (ctx) => {
      // Blue plastic cistern with a cap.
      fill(ctx, 2, 4, 12, 11, '#22313c');
      fill(ctx, 3, 5, 10, 9, '#3c6b8a');
      fill(ctx, 3, 5, 10, 1, '#5d93b5');
      fill(ctx, 3, 9, 10, 3, '#2f5670');
      fill(ctx, 3, 9, 10, 1, '#4d82a4');
      fill(ctx, 6, 2, 4, 2, '#5d93b5');
      fill(ctx, 7, 1, 2, 1, '#8fb8d2');
      fill(ctx, 4, 12, 8, 1, '#22313c');
    },
    true,
  );
}

function createDepotTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'structure-depot',
    18,
    18,
    (ctx) => {
      fill(ctx, 1, 2, 16, 15, PALETTE.woodDark);
      fill(ctx, 2, 3, 14, 13, PALETTE.wood);
      fill(ctx, 2, 3, 14, 2, PALETTE.woodLight);
      fill(ctx, 7, 6, 4, 10, PALETTE.woodDark);
      fill(ctx, 8, 7, 2, 8, PALETTE.metal);
      fill(ctx, 1, 1, 16, 1, PALETTE.metal);
    },
    true,
  );
}

function createWorkshopTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'structure-workshop',
    18,
    18,
    (ctx) => {
      fill(ctx, 1, 3, 16, 13, PALETTE.metal);
      fill(ctx, 2, 4, 14, 11, '#4a5b66');
      fill(ctx, 2, 4, 14, 2, '#6f8492');
      fill(ctx, 4, 8, 10, 6, '#2f3a42');
      fill(ctx, 5, 9, 4, 4, PALETTE.metalLight);
      fill(ctx, 10, 9, 3, 4, PALETTE.rust);
      fill(ctx, 1, 2, 16, 1, PALETTE.metalLight);
    },
    true,
  );
}

function createTurretStructureTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'structure-turret',
    18,
    18,
    (ctx) => {
      fillCircle(ctx, 9, 11, 6, PALETTE.metal);
      fillCircle(ctx, 9, 11, 4, PALETTE.rust);
      fillCircle(ctx, 9, 11, 2, PALETTE.metalLight);
      fill(ctx, 8, 1, 2, 8, PALETTE.metal);
      fill(ctx, 7, 1, 4, 2, PALETTE.rustLight);
      fill(ctx, 3, 14, 12, 2, PALETTE.metal);
    },
    true,
  );
}

function createGeneratorTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'structure-generator',
    18,
    18,
    (ctx) => {
      fill(ctx, 1, 3, 16, 13, PALETTE.hazardDark);
      fill(ctx, 2, 4, 14, 11, '#6b5a26');
      fill(ctx, 3, 5, 12, 4, PALETTE.hazard);
      fill(ctx, 3, 10, 12, 1, PALETTE.hazardDark);
      fill(ctx, 3, 12, 12, 1, PALETTE.hazardDark);
      fill(ctx, 13, 6, 2, 2, PALETTE.metalLight);
      fill(ctx, 1, 2, 16, 1, PALETTE.metal);
    },
    true,
  );
}

function createPadTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'prop-base-pad',
    44,
    36,
    (ctx) => {
      fill(ctx, 0, 0, 44, 36, PALETTE.concreteDark);
      fill(ctx, 2, 2, 40, 32, PALETTE.concrete);

      // Concrete seams.
      for (let x = 2; x < 42; x += 10) {
        fill(ctx, x, 2, 1, 32, PALETTE.concreteDark);
      }
      for (let y = 2; y < 34; y += 8) {
        fill(ctx, 2, y, 40, 1, PALETTE.concreteDark);
      }

      // Hazard corner stripes.
      const hazardCorner = (x: number, y: number): void => {
        for (let i = 0; i < 7; i += 1) {
          fill(ctx, x + i, y, 1, 1, i % 2 === 0 ? PALETTE.hazard : PALETTE.hazardDark);
          fill(ctx, x, y + i, 1, 1, i % 2 === 0 ? PALETTE.hazard : PALETTE.hazardDark);
        }
      };
      hazardCorner(3, 3);
      hazardCorner(37, 3);
      hazardCorner(3, 28);
      hazardCorner(37, 28);

      // Faded base stencil in the middle.
      fill(ctx, 15, 12, 14, 2, PALETTE.concreteLight);
      fill(ctx, 15, 22, 14, 2, PALETTE.concreteLight);
      fill(ctx, 15, 12, 2, 12, PALETTE.concreteLight);
      fill(ctx, 27, 12, 2, 12, PALETTE.concreteLight);
      fill(ctx, 20, 17, 4, 2, PALETTE.concreteDark);

      // Cracks.
      fill(ctx, 8, 8, 3, 1, PALETTE.concreteDark);
      fill(ctx, 10, 9, 1, 4, PALETTE.concreteDark);
      fill(ctx, 33, 26, 4, 1, PALETTE.concreteDark);
      fill(ctx, 35, 23, 1, 3, PALETTE.concreteDark);
      fill(ctx, 24, 6, 1, 3, PALETTE.concreteDark);
    },
    false,
  );
}

function createTurretTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'vehicle-turret',
    14,
    20,
    (ctx) => {
      // Art points up (+Y); the renderer rotates it to the aim angle.
      fill(ctx, 3, 11, 8, 6, PALETTE.metal);
      fill(ctx, 4, 12, 6, 4, PALETTE.metalLight);
      fill(ctx, 3, 10, 8, 1, PALETTE.rustDark);
      fill(ctx, 6, 2, 2, 11, PALETTE.metalLight);
      fill(ctx, 5, 0, 4, 3, PALETTE.tire);
      fill(ctx, 6, 15, 2, 3, PALETTE.rustDark);
      fill(ctx, 2, 16, 10, 2, PALETTE.rust);
    },
    true,
  );
}

function createCrosshairTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'crosshair',
    20,
    20,
    (ctx) => {
      fill(ctx, 9, 1, 2, 5, PALETTE.hazard);
      fill(ctx, 9, 14, 2, 5, PALETTE.hazard);
      fill(ctx, 1, 9, 5, 2, PALETTE.hazard);
      fill(ctx, 14, 9, 5, 2, PALETTE.hazard);
      fill(ctx, 9, 9, 2, 2, PALETTE.white);
      fill(ctx, 3, 3, 2, 2, PALETTE.hazardDark);
      fill(ctx, 15, 3, 2, 2, PALETTE.hazardDark);
      fill(ctx, 3, 15, 2, 2, PALETTE.hazardDark);
      fill(ctx, 15, 15, 2, 2, PALETTE.hazardDark);
    },
    true,
  );
}

function createBulletTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'projectile-bullet',
    4,
    8,
    (ctx) => {
      fill(ctx, 1, 0, 2, 8, PALETTE.headlight);
      fill(ctx, 1, 0, 2, 2, PALETTE.white);
      fill(ctx, 1, 6, 2, 2, PALETTE.rustLight);
    },
    true,
  );
}

function createShellTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'projectile-shell',
    6,
    12,
    (ctx) => {
      fill(ctx, 1, 0, 4, 10, PALETTE.rust);
      fill(ctx, 2, 0, 2, 3, PALETTE.hazard);
      fill(ctx, 2, 4, 2, 3, PALETTE.rustLight);
      fill(ctx, 1, 8, 4, 4, PALETTE.metal);
    },
    true,
  );
}

function createMuzzleFlashTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'effect-muzzle-flash',
    16,
    16,
    (ctx) => {
      fillCircle(ctx, 8, 8, 6, PALETTE.rustLight);
      fillCircle(ctx, 8, 8, 4, PALETTE.hazard);
      fillCircle(ctx, 8, 8, 2, PALETTE.white);
      fill(ctx, 7, 0, 2, 4, PALETTE.hazard);
      fill(ctx, 7, 12, 2, 4, PALETTE.hazard);
      fill(ctx, 0, 7, 4, 2, PALETTE.hazard);
      fill(ctx, 12, 7, 4, 2, PALETTE.hazard);
    },
    true,
  );
}

function createHitSparkTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'effect-hit-spark',
    10,
    10,
    (ctx) => {
      fillCircle(ctx, 5, 5, 2, PALETTE.white);
      fill(ctx, 4, 0, 2, 3, PALETTE.hazard);
      fill(ctx, 4, 7, 2, 3, PALETTE.hazard);
      fill(ctx, 0, 4, 3, 2, PALETTE.hazard);
      fill(ctx, 7, 4, 3, 2, PALETTE.hazard);
      fill(ctx, 1, 1, 1, 1, PALETTE.rustLight);
      fill(ctx, 8, 8, 1, 1, PALETTE.rustLight);
    },
    true,
  );
}

function createExplosionTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'effect-explosion',
    28,
    28,
    (ctx) => {
      fillCircle(ctx, 14, 14, 12, PALETTE.rustDark);
      fillCircle(ctx, 14, 14, 9, PALETTE.rust);
      fillCircle(ctx, 14, 14, 6, PALETTE.hazard);
      fillCircle(ctx, 14, 14, 3, PALETTE.white);
      fill(ctx, 1, 5, 3, 2, PALETTE.rust);
      fill(ctx, 23, 8, 4, 2, PALETTE.rustLight);
      fill(ctx, 5, 23, 2, 3, PALETTE.rust);
      fill(ctx, 20, 22, 3, 2, PALETTE.rustDark);
    },
    true,
  );
}

function createDebrisTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'effect-debris',
    14,
    14,
    (ctx) => {
      fill(ctx, 1, 6, 4, 3, PALETTE.metal);
      fill(ctx, 8, 1, 3, 4, PALETTE.rock);
      fill(ctx, 8, 8, 5, 3, PALETTE.rust);
      fill(ctx, 3, 2, 2, 2, PALETTE.metalLight);
      fill(ctx, 11, 12, 2, 1, PALETTE.rockLight);
    },
    true,
  );
}

function createRaiderTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'enemy-raider',
    22,
    26,
    (ctx) => {
      // Spiked buggy: dark body, red trim, forward-pointing ram.
      fill(ctx, 4, 4, 14, 18, '#2b2621');
      fill(ctx, 5, 6, 12, 14, '#4a3a2c');
      fill(ctx, 6, 8, 10, 3, '#d0613f');
      fill(ctx, 7, 13, 8, 6, '#3a2f26');
      fill(ctx, 9, 2, 4, 5, '#8c4a2e');
      fill(ctx, 10, 0, 2, 3, PALETTE.metalLight);
      fill(ctx, 2, 8, 3, 8, '#1b1a18');
      fill(ctx, 17, 8, 3, 8, '#1b1a18');
      fill(ctx, 6, 22, 3, 4, '#1b1a18');
      fill(ctx, 13, 22, 3, 4, '#1b1a18');
      fill(ctx, 8, 11, 6, 2, '#d5a535');
    },
    true,
  );
}

function createScrapDummyTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'enemy-scrap-dummy',
    20,
    24,
    (ctx) => {
      fill(ctx, 3, 21, 14, 2, PALETTE.borderDark);
      fill(ctx, 7, 18, 6, 4, PALETTE.metal);
      fillCircle(ctx, 10, 11, 7, PALETTE.rustDark);
      fillCircle(ctx, 10, 11, 6, PALETTE.rust);
      fillCircle(ctx, 10, 11, 4, PALETTE.rustLight);
      fill(ctx, 3, 7, 14, 2, PALETTE.metal);
      fill(ctx, 3, 15, 14, 2, PALETTE.metal);
      fillCircle(ctx, 10, 11, 3, PALETTE.hazard);
      fillCircle(ctx, 10, 11, 2, PALETTE.rustDark);
      fillCircle(ctx, 10, 11, 1, PALETTE.white);
      fill(ctx, 7, 2, 6, 5, PALETTE.metal);
      fill(ctx, 8, 3, 4, 2, PALETTE.glassLight);
      fill(ctx, 4, 9, 1, 4, PALETTE.rustDark);
      fill(ctx, 15, 9, 1, 4, PALETTE.rustDark);
    },
    true,
  );
}

function createHeavyDummyTexture(scene: Scene): DynamicTexture {
  return createPixelTexture(
    scene,
    'enemy-heavy-dummy',
    26,
    30,
    (ctx) => {
      fill(ctx, 4, 27, 18, 2, PALETTE.borderDark);
      fill(ctx, 9, 23, 8, 5, PALETTE.metal);
      fillCircle(ctx, 13, 15, 10, PALETTE.rustDark);
      fillCircle(ctx, 13, 15, 8, PALETTE.metal);
      fillCircle(ctx, 13, 15, 6, PALETTE.metalLight);
      fill(ctx, 5, 9, 16, 2, PALETTE.rustDark);
      fill(ctx, 5, 20, 16, 2, PALETTE.rustDark);
      fillCircle(ctx, 13, 15, 4, PALETTE.rust);
      fillCircle(ctx, 13, 15, 2, PALETTE.taillight);
      fill(ctx, 9, 3, 8, 6, PALETTE.metal);
      fill(ctx, 10, 4, 6, 2, PALETTE.taillight);
      fill(ctx, 2, 12, 3, 7, PALETTE.rust);
      fill(ctx, 21, 12, 3, 7, PALETTE.rust);
      fill(ctx, 11, 8, 4, 1, PALETTE.white);
    },
    true,
  );
}

const STRUCTURE_TEXTURE_BUILDERS: Readonly<
  Record<StructureKind, (scene: Scene) => DynamicTexture>
> = {
  depot: createDepotTexture,
  workshop: createWorkshopTexture,
  turret: createTurretStructureTexture,
  generator: createGeneratorTexture,
};

const RESOURCE_TEXTURE_BUILDERS: Readonly<
  Record<ResourceKind, (scene: Scene) => DynamicTexture>
> = {
  scrap: createScrapNodeTexture,
  fuel: createFuelNodeTexture,
  water: createWaterNodeTexture,
};

const PROP_TEXTURE_BUILDERS: Readonly<Record<PropKind, (scene: Scene) => DynamicTexture>> = {
  rock: createRockTexture,
  wreck: createWreckTexture,
  crate: createCrateTexture,
  pad: createPadTexture,
};

export interface PropTextureSet {
  readonly ground: DynamicTexture;
  readonly groundTile: DynamicTexture;
  readonly vehicle: DynamicTexture;
  readonly turret: DynamicTexture;
  readonly crosshair: DynamicTexture;
  readonly props: Readonly<Record<PropKind, DynamicTexture>>;
  readonly projectiles: Readonly<Record<ProjectileKind, DynamicTexture>>;
  readonly effects: Readonly<Record<EffectKind, DynamicTexture>>;
  readonly enemies: Readonly<Record<EnemyKind, DynamicTexture>>;
  readonly resources: Readonly<Record<ResourceKind, DynamicTexture>>;
  readonly structures: Readonly<Record<StructureKind, DynamicTexture>>;
}

export function createTextureSet(scene: Scene): PropTextureSet {
  const props = {
    rock: PROP_TEXTURE_BUILDERS.rock(scene),
    wreck: PROP_TEXTURE_BUILDERS.wreck(scene),
    crate: PROP_TEXTURE_BUILDERS.crate(scene),
    pad: PROP_TEXTURE_BUILDERS.pad(scene),
  } satisfies Record<PropKind, DynamicTexture>;

  return {
    ground: createGroundTexture(scene),
    groundTile: createOpenWorldGroundTexture(scene),
    vehicle: createVehicleTexture(scene),
    turret: createTurretTexture(scene),
    crosshair: createCrosshairTexture(scene),
    props,
    projectiles: {
      bullet: createBulletTexture(scene),
      shell: createShellTexture(scene),
    },
    effects: {
      'muzzle-flash': createMuzzleFlashTexture(scene),
      'hit-spark': createHitSparkTexture(scene),
      explosion: createExplosionTexture(scene),
      debris: createDebrisTexture(scene),
    },
    enemies: {
      'scrap-dummy': createScrapDummyTexture(scene),
      'heavy-dummy': createHeavyDummyTexture(scene),
      raider: createRaiderTexture(scene),
    },
    resources: {
      scrap: RESOURCE_TEXTURE_BUILDERS.scrap(scene),
      fuel: RESOURCE_TEXTURE_BUILDERS.fuel(scene),
      water: RESOURCE_TEXTURE_BUILDERS.water(scene),
    },
    structures: {
      depot: STRUCTURE_TEXTURE_BUILDERS.depot(scene),
      workshop: STRUCTURE_TEXTURE_BUILDERS.workshop(scene),
      turret: STRUCTURE_TEXTURE_BUILDERS.turret(scene),
      generator: STRUCTURE_TEXTURE_BUILDERS.generator(scene),
    },
  };
}

/**
 * Creates an unlit material so the pixel art keeps its authored colors.
 * `emissiveTexture` supplies color and `opacityTexture` supplies the alpha
 * cutout; this avoids depending on scene lights.
 */
export function createUnlitMaterial(
  scene: Scene,
  name: string,
  texture: DynamicTexture,
  withAlpha: boolean,
  alphaMode: 'cutout' | 'blend' = 'cutout',
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  // All visuals are camera-facing 2D planes; disable culling so winding in
  // either handedness never hides a surface.
  material.backFaceCulling = false;
  material.disableLighting = true;
  // Emissive color is ADDED to the emissive map, so keep it black; the map
  // supplies the actual pixel-art colors.
  material.emissiveColor = Color3.Black();
  material.emissiveTexture = texture;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.ambientColor = Color3.Black();

  if (withAlpha) {
    material.opacityTexture = texture;
    if (alphaMode === 'blend') {
      material.transparencyMode = Material.MATERIAL_ALPHABLEND;
      material.alphaCutOff = 0;
    } else {
      material.transparencyMode = Material.MATERIAL_ALPHATEST;
      material.alphaCutOff = 0.5;
    }
  }

  return material;
}

/** Solid-color unlit material for health bars and other simple UI props. */
export function createFlatMaterial(
  scene: Scene,
  name: string,
  color: string,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.backFaceCulling = false;
  material.disableLighting = true;
  material.emissiveColor = Color3.FromHexString(color);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.ambientColor = Color3.Black();
  return material;
}

export interface SpriteOptions {
  readonly width: number;
  readonly height: number;
  readonly z?: number;
  readonly alphaMode?: 'cutout' | 'blend';
}

export function createSprite(
  scene: Scene,
  name: string,
  texture: DynamicTexture,
  options: SpriteOptions,
): Mesh {
  const mesh = CreatePlane(
    name,
    { width: options.width, height: options.height },
    scene,
  );
  mesh.position.z = options.z ?? 1;
  mesh.material = createUnlitMaterial(
    scene,
    `${name}-material`,
    texture,
    true,
    options.alphaMode ?? 'cutout',
  );
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

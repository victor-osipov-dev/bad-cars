import { Camera } from '@babylonjs/core/Cameras/camera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { ArenaConfig } from '../data/gameplay';
import {
  clampCameraCenter,
  dampCameraCenter,
  desiredFollowCenter,
  type CameraPoint,
  type CameraViewBounds,
} from './cameraFollow';

export interface TopDownCameraOptions {
  /** Half of the vertical world span at zoom 1. Defaults to 13. */
  readonly viewHalfHeight?: number;
  /** Minimum horizontal half-span so narrow portrait screens stay usable. */
  readonly minViewHalfWidth?: number;
  /** Follow smoothing, 1/s. */
  readonly followSharpness?: number;
  readonly deadZoneX?: number;
  readonly deadZoneY?: number;
}

/**
 * Top-down orthographic follow camera.
 *
 * The simulation lives on the XY plane; the camera sits high on +Z, looks down
 * -Z and has no tilt or yaw, so world coordinates map directly to the screen.
 * It follows the vehicle inside a dead-zone rectangle and is clamped so the
 * visible area never leaves the arena.
 */
export class TopDownOrthoCamera {
  readonly camera: FreeCamera;

  readonly #arena: ArenaConfig;
  readonly #viewHalfHeight: number;
  readonly #minViewHalfWidth: number;
  readonly #followSharpness: number;
  readonly #deadZoneX: number;
  readonly #deadZoneY: number;

  #view: CameraViewBounds = { halfWidth: 0, halfHeight: 0 };
  #center: CameraPoint = { x: 0, y: 0 };

  constructor(scene: Scene, arena: ArenaConfig, options: TopDownCameraOptions = {}) {
    this.#arena = arena;
    this.#viewHalfHeight = options.viewHalfHeight ?? 13;
    this.#minViewHalfWidth = options.minViewHalfWidth ?? 9;
    this.#followSharpness = options.followSharpness ?? 5.5;
    this.#deadZoneX = options.deadZoneX ?? 1.8;
    this.#deadZoneY = options.deadZoneY ?? 1.2;

    this.camera = new FreeCamera(
      'top-down-camera',
      new Vector3(0, 0, 60),
      scene,
    );
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(new Vector3(0, 0, 0));
    this.camera.upVector = new Vector3(0, 1, 0);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 200;
    // No attachControl: the camera must stay strictly top-down.
  }

  get view(): CameraViewBounds {
    return this.#view;
  }

  get center(): CameraPoint {
    return this.#center;
  }

  /**
   * Fits the viewport while preserving aspect. On portrait screens the view
   * expands vertically instead of cropping too much horizontal space.
   */
  fit(viewportWidth: number, viewportHeight: number): void {
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const aspect = viewportWidth / viewportHeight;
    let halfHeight = this.#viewHalfHeight;
    let halfWidth = halfHeight * aspect;

    if (halfWidth < this.#minViewHalfWidth) {
      halfWidth = this.#minViewHalfWidth;
      halfHeight = halfWidth / aspect;
    }

    this.#view = { halfWidth, halfHeight };
    this.camera.orthoLeft = -halfWidth;
    this.camera.orthoRight = halfWidth;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
    this.#center = clampCameraCenter(this.#center, this.#view, this.#arena);
    this.#applyCenter();
  }

  /** Snaps immediately to a target (initial spawn, teleports, respawn). */
  snapTo(x: number, y: number): void {
    this.#center = clampCameraCenter({ x, y }, this.#view, this.#arena);
    this.#applyCenter();
  }

  /** Smoothly follows a target, respecting the dead zone and arena bounds. */
  follow(target: CameraPoint, deltaSeconds: number): void {
    const desired = desiredFollowCenter(
      this.#center,
      target,
      { x: this.#deadZoneX, y: this.#deadZoneY },
      this.#view,
      this.#arena,
    );
    this.#center = dampCameraCenter(
      this.#center,
      desired,
      this.#followSharpness,
      deltaSeconds,
    );
    this.#applyCenter();
  }

  #applyCenter(): void {
    this.camera.position.x = this.#center.x;
    this.camera.position.y = this.#center.y;
    this.camera.setTarget(new Vector3(this.#center.x, this.#center.y, 0));
  }
}

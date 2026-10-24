import type { Vec2 } from '../../core/math/Vec2';

/** Mutable vehicle body state. Serializable; no render dependencies. */
export interface VehicleState {
  position: Vec2;
  velocity: Vec2;
  /** Radians, counter-clockwise from +X. */
  heading: number;
  /** Smoothed steering input, -1 (left) .. +1 (right). */
  steering: number;
}

/** Static circular collider derived from a solid prop. */
export interface ObstacleCircle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface VehicleKinematics {
  readonly speed: number;
  /** Signed velocity along the heading axis; negative when rolling backwards. */
  readonly forwardSpeed: number;
  readonly lateralSpeed: number;
}

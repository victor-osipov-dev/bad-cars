import { clamp } from '../core/math/scalar';

export interface CameraViewBounds {
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export interface CameraPoint {
  readonly x: number;
  readonly y: number;
}

export interface DeadZone {
  readonly x: number;
  readonly y: number;
}

/**
 * Computes the desired camera center for a target.
 *
 * The target may move freely inside the dead-zone rectangle. Outside it, the
 * camera follows just enough to keep the target on the rectangle edge. The
 * result is clamped so the view never shows space outside the arena.
 */
export function desiredFollowCenter(
  center: CameraPoint,
  target: CameraPoint,
  deadZone: DeadZone,
  view: CameraViewBounds,
  arena: CameraViewBounds,
): CameraPoint {
  const offsetX = target.x - center.x;
  const offsetY = target.y - center.y;

  let desiredX = center.x;
  let desiredY = center.y;

  if (offsetX > deadZone.x) desiredX = target.x - deadZone.x;
  else if (offsetX < -deadZone.x) desiredX = target.x + deadZone.x;

  if (offsetY > deadZone.y) desiredY = target.y - deadZone.y;
  else if (offsetY < -deadZone.y) desiredY = target.y + deadZone.y;

  const maxX = Math.max(0, arena.halfWidth - view.halfWidth);
  const maxY = Math.max(0, arena.halfHeight - view.halfHeight);

  return {
    x: clamp(desiredX, -maxX, maxX),
    y: clamp(desiredY, -maxY, maxY),
  };
}

/** Frame-rate independent exponential smoothing of the camera center. */
export function dampCameraCenter(
  current: CameraPoint,
  desired: CameraPoint,
  sharpness: number,
  deltaSeconds: number,
): CameraPoint {
  if (sharpness <= 0 || !(deltaSeconds > 0)) return current;
  const t = 1 - Math.exp(-sharpness * deltaSeconds);
  return {
    x: current.x + (desired.x - current.x) * t,
    y: current.y + (desired.y - current.y) * t,
  };
}

/** Keeps a camera center valid for the arena after a resize. */
export function clampCameraCenter(
  center: CameraPoint,
  view: CameraViewBounds,
  arena: CameraViewBounds,
): CameraPoint {
  const maxX = Math.max(0, arena.halfWidth - view.halfWidth);
  const maxY = Math.max(0, arena.halfHeight - view.halfHeight);
  return {
    x: clamp(center.x, -maxX, maxX),
    y: clamp(center.y, -maxY, maxY),
  };
}

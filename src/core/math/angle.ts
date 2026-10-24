/** Angle helpers. All angles are radians, counter-clockwise from +X. */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;

/** Wraps an angle into the half-open range [-PI, PI). */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  // The formula can produce PI when the input is exactly representable as PI
  // after a large number of turns due to floating point rounding.
  return wrapped >= Math.PI ? wrapped - TAU : wrapped;
}

/** Shortest signed rotation from `from` to `to`, range [-PI, PI). */
export function angleDifference(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Rotates `current` towards `target` by at most `maxDelta` radians. */
export function rotateTowards(current: number, target: number, maxDelta: number): number {
  const diff = angleDifference(current, target);
  if (Math.abs(diff) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxDelta);
}

/** Interpolates along the shortest arc. */
export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + angleDifference(from, to) * t);
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

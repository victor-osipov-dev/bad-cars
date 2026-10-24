/** Small, dependency-free scalar helpers used by the simulation. */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolation. `t` is not clamped. */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Inverse of {@link lerp}. Returns 0 when the input range is degenerate. */
export function inverseLerp(from: number, to: number, value: number): number {
  if (from === to) return 0;
  return (value - from) / (to - from);
}

/** Moves `current` towards `target` by at most `maxDelta`. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, deltaSeconds: number): number {
  if (lambda <= 0 || deltaSeconds <= 0) return current;
  return lerp(current, target, 1 - Math.exp(-lambda * deltaSeconds));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Epsilon-based comparison; NaN never equals anything. */
export function approxEqual(a: number, b: number, epsilon = 1e-9): boolean {
  return a === b || Math.abs(a - b) <= epsilon;
}

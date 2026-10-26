/**
 * Swept-circle collision for fast projectiles.
 *
 * Returns the first normalized time in [0, 1] at which the segment
 * (fromX, fromY) -> (toX, toY) intersects the circle, or null.
 */
export function sweepCircle(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  centerX: number,
  centerY: number,
  radius: number,
): number | null {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const offsetX = fromX - centerX;
  const offsetY = fromY - centerY;

  const a = deltaX * deltaX + deltaY * deltaY;
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;

  if (c <= 0) return 0;
  if (a <= 1e-12) return null;

  const b = 2 * (offsetX * deltaX + offsetY * deltaY);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const enter = (-b - root) / (2 * a);
  if (enter >= 0 && enter <= 1) return enter;

  return null;
}

/**
 * True when a solid obstacle sits between two points.
 *
 * Used by base turrets: firing at a target behind a rock only wastes ammo and
 * makes the defence look broken, so the target is skipped instead.
 */
export function isSegmentBlocked(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  obstacles: readonly { readonly x: number; readonly y: number; readonly radius: number }[],
  margin = 0,
): boolean {
  for (const obstacle of obstacles) {
    // `margin` covers the projectile radius: a round that merely clips a rock
    // still shatters on it, so line of sight must be at least that generous.
    const radius = obstacle.radius + margin;
    if (sweepCircle(fromX, fromY, toX, toY, obstacle.x, obstacle.y, radius) !== null) {
      return true;
    }
  }
  return false;
}

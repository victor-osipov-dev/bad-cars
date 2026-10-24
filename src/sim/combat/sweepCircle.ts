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

/** Immutable 2D vector. Simulation-facing; no rendering dependencies. */
export class Vec2 {
  static readonly ZERO = new Vec2(0, 0);

  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  static fromAngle(radians: number, length = 1): Vec2 {
    return new Vec2(Math.cos(radians) * length, Math.sin(radians) * length);
  }

  add(other: Vec2): Vec2 {
    return new Vec2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vec2): Vec2 {
    return new Vec2(this.x - other.x, this.y - other.y);
  }

  scale(factor: number): Vec2 {
    return new Vec2(this.x * factor, this.y * factor);
  }

  negate(): Vec2 {
    return new Vec2(-this.x, -this.y);
  }

  dot(other: Vec2): number {
    return this.x * other.x + this.y * other.y;
  }

  /** 2D cross product (z-component of the 3D cross product). */
  cross(other: Vec2): number {
    return this.x * other.y - this.y * other.x;
  }

  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  distanceSquaredTo(other: Vec2): number {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    return dx * dx + dy * dy;
  }

  distanceTo(other: Vec2): number {
    return Math.sqrt(this.distanceSquaredTo(other));
  }

  /** Returns a unit vector, or ZERO for a zero-length vector. */
  normalized(): Vec2 {
    const length = this.length();
    if (length === 0) return Vec2.ZERO;
    return new Vec2(this.x / length, this.y / length);
  }

  /** Rotates counter-clockwise by `radians`. */
  rotate(radians: number): Vec2 {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return new Vec2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  /** Perpendicular vector rotated 90° counter-clockwise. */
  perpendicular(): Vec2 {
    return new Vec2(-this.y, this.x);
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  lerp(other: Vec2, t: number): Vec2 {
    return new Vec2(this.x + (other.x - this.x) * t, this.y + (other.y - this.y) * t);
  }

  equals(other: Vec2, epsilon = 1e-9): boolean {
    return Math.abs(this.x - other.x) <= epsilon && Math.abs(this.y - other.y) <= epsilon;
  }

  toJSON(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }
}

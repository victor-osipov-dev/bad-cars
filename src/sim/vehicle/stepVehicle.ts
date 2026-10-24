import { wrapAngle } from '../../core/math/angle';
import { clamp, moveTowards } from '../../core/math/scalar';
import { Vec2 } from '../../core/math/Vec2';
import type { ArenaConfig } from '../../data/gameplay';
import type { VehicleConfig } from '../../data/vehicles';
import { createDriveControls, type DriveControls } from '../input/DriveCommand';
import type { ObstacleCircle, VehicleKinematics, VehicleState } from './VehicleState';

/**
 * Right-hand lateral axis for a forward vector.
 *
 * Derived from the forward vector instead of a second `fromAngle` call: at
 * cardinal headings `fromAngle(h - PI/2)` returns ~6.1e-17 instead of 0, which
 * breaks orthogonality and lets lateral velocity leak back into the forward
 * axis. That residue was enough to make the car look like it was still rolling
 * forward, so reverse gear could never engage.
 */
function rightOf(forward: Vec2): Vec2 {
  return new Vec2(forward.y, -forward.x);
}

export interface VehicleStepParams {
  readonly config: VehicleConfig;
  readonly arena: ArenaConfig;
  readonly obstacles: readonly ObstacleCircle[];
  readonly controls: DriveControls;
  readonly deltaSeconds: number;
}

export function vehicleKinematics(state: VehicleState): VehicleKinematics {
  const forward = Vec2.fromAngle(state.heading);
  const right = rightOf(forward);
  return {
    speed: state.velocity.length(),
    forwardSpeed: state.velocity.dot(forward),
    lateralSpeed: state.velocity.dot(right),
  };
}

/**
 * Advances the arcade vehicle model by one fixed step.
 *
 * Pure with respect to `state` (returns a new object) and deterministic: no
 * randomness, no wall-clock time. Automatic throttle keeps the car rolling;
 * the handbrake lowers lateral grip to allow drifts.
 */
export function stepVehicle(state: VehicleState, params: VehicleStepParams): VehicleState {
  const { config, arena, obstacles, deltaSeconds } = params;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return state;
  }

  const controls = createDriveControls(params.controls);
  const physics = config.physics;
  const collision = config.collision;

  const heading = wrapAngle(state.heading);
  const forward = Vec2.fromAngle(heading);
  const right = rightOf(forward);

  let forwardSpeed = state.velocity.dot(forward);
  let lateralSpeed = state.velocity.dot(right);

  const targetSteering = clamp(controls.steer, -1, 1);
  const steering = moveTowards(
    state.steering,
    targetSteering,
    physics.steerResponse * deltaSeconds,
  );

  if (controls.brake > 0) {
    forwardSpeed = moveTowards(
      forwardSpeed,
      0,
      physics.brakeDeceleration * controls.brake * deltaSeconds,
    );
  } else if (controls.reverse > 0) {
    // Reverse gear: brake out of forward motion first, then back up.
    const reverseCap = physics.maxReverseSpeed * controls.reverse;
    if (forwardSpeed > 0) {
      forwardSpeed = moveTowards(
        forwardSpeed,
        0,
        physics.brakeDeceleration * controls.reverse * deltaSeconds,
      );
    } else if (forwardSpeed > -reverseCap) {
      forwardSpeed = Math.max(
        -reverseCap,
        forwardSpeed - physics.engineAcceleration * controls.reverse * deltaSeconds,
      );
    }
  } else if (controls.throttle > 0 && forwardSpeed >= 0) {
    const speedRatio = clamp(forwardSpeed / physics.maxForwardSpeed, 0, 1);
    const engine = physics.engineAcceleration * controls.throttle * (1 - speedRatio);
    forwardSpeed += engine * deltaSeconds;
  }

  if (controls.handbrake) {
    forwardSpeed = moveTowards(
      forwardSpeed,
      0,
      physics.handbrakeDeceleration * deltaSeconds,
    );
  }

  const resistance = physics.rollingResistance + physics.aerodynamicDrag * forwardSpeed * forwardSpeed;
  forwardSpeed = moveTowards(forwardSpeed, 0, resistance * deltaSeconds);
  forwardSpeed = clamp(forwardSpeed, -physics.maxReverseSpeed, physics.maxForwardSpeed);
  // Kill floating-point dust so tiny residuals cannot keep the car stuck in a
  // braking state when the driver is actually holding reverse.
  if (Math.abs(forwardSpeed) < 1e-9) forwardSpeed = 0;

  const lateralGrip = controls.handbrake ? physics.handbrakeGrip : physics.lateralGrip;
  lateralSpeed *= Math.exp(-lateralGrip * deltaSeconds);

  const speedAbs = Math.abs(forwardSpeed);
  const authority = clamp(speedAbs / physics.steerSpeedReference, 0, 1);
  const speedRatio = clamp(speedAbs / physics.maxForwardSpeed, 0, 1);
  const authorityFactor = authority * (1 - physics.highSpeedSteerPenalty * speedRatio * speedRatio);
  const travelDirection = forwardSpeed < 0 ? -1 : 1;
  const yawDelta = -steering * physics.maxYawRate * authorityFactor * travelDirection * deltaSeconds;
  const nextHeading = wrapAngle(heading + yawDelta);

  const nextForward = Vec2.fromAngle(nextHeading);
  const nextRight = rightOf(nextForward);
  let velocity = nextForward.scale(forwardSpeed).add(nextRight.scale(lateralSpeed));
  let position = state.position.add(velocity.scale(deltaSeconds));

  const radius = collision.radius;
  for (const obstacle of obstacles) {
    const dx = position.x - obstacle.x;
    const dy = position.y - obstacle.y;
    const minDistance = radius + obstacle.radius;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= minDistance * minDistance) continue;

    const distance = Math.sqrt(distanceSquared);
    const normalX = distance > 1e-6 ? dx / distance : nextForward.x;
    const normalY = distance > 1e-6 ? dy / distance : nextForward.y;

    position = new Vec2(
      obstacle.x + normalX * minDistance,
      obstacle.y + normalY * minDistance,
    );

    const normalSpeed = velocity.x * normalX + velocity.y * normalY;
    if (normalSpeed < 0) {
      const tangentX = -normalY;
      const tangentY = normalX;
      const tangentSpeed = velocity.x * tangentX + velocity.y * tangentY;
      const bouncedNormal = -normalSpeed * collision.restitution;
      const keptTangent = tangentSpeed * (1 - collision.impactFriction);
      velocity = new Vec2(
        normalX * bouncedNormal + tangentX * keptTangent,
        normalY * bouncedNormal + tangentY * keptTangent,
      );
    }
  }

  const maxX = Math.max(0, arena.halfWidth - radius);
  const maxY = Math.max(0, arena.halfHeight - radius);
  if (position.x > maxX) {
    position = new Vec2(maxX, position.y);
    if (velocity.x > 0) {
      velocity = new Vec2(-velocity.x * collision.restitution, velocity.y);
    }
  } else if (position.x < -maxX) {
    position = new Vec2(-maxX, position.y);
    if (velocity.x < 0) {
      velocity = new Vec2(-velocity.x * collision.restitution, velocity.y);
    }
  }
  if (position.y > maxY) {
    position = new Vec2(position.x, maxY);
    if (velocity.y > 0) {
      velocity = new Vec2(velocity.x, -velocity.y * collision.restitution);
    }
  } else if (position.y < -maxY) {
    position = new Vec2(position.x, -maxY);
    if (velocity.y < 0) {
      velocity = new Vec2(velocity.x, -velocity.y * collision.restitution);
    }
  }

  return { position, velocity, heading: nextHeading, steering };
}

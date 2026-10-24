import { describe, expect, it } from 'vitest';
import { Vec2 } from '../../core/math/Vec2';
import type { ArenaConfig } from '../../data/gameplay';
import { SCRAP_RUNNER } from '../../data/vehicles';
import { AUTO_DRIVE_CONTROLS, type DriveControls } from '../input/DriveCommand';
import type { ObstacleCircle, VehicleState } from './VehicleState';
import { stepVehicle, vehicleKinematics } from './stepVehicle';

const DT = 1 / 60;
const LARGE_ARENA: ArenaConfig = { halfWidth: 1000, halfHeight: 1000 };

function createState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    position: new Vec2(0, 0),
    velocity: Vec2.ZERO,
    heading: 0,
    steering: 0,
    ...overrides,
  };
}

function controls(overrides: Partial<DriveControls> = {}): DriveControls {
  return { ...AUTO_DRIVE_CONTROLS, ...overrides };
}

function run(
  state: VehicleState,
  ticks: number,
  driveControls: DriveControls = AUTO_DRIVE_CONTROLS,
  options: {
    readonly arena?: ArenaConfig;
    readonly obstacles?: readonly ObstacleCircle[];
  } = {},
): VehicleState {
  let current = state;
  for (let i = 0; i < ticks; i += 1) {
    current = stepVehicle(current, {
      config: SCRAP_RUNNER,
      arena: options.arena ?? LARGE_ARENA,
      obstacles: options.obstacles ?? [],
      controls: driveControls,
      deltaSeconds: DT,
    });
  }
  return current;
}

describe('stepVehicle', () => {
  it('accelerates forward without steering drift', () => {
    const state = run(createState(), 60);
    const kinematics = vehicleKinematics(state);

    expect(kinematics.speed).toBeGreaterThan(3);
    expect(state.position.x).toBeGreaterThan(1);
    expect(state.position.y).toBeCloseTo(0, 9);
    expect(state.heading).toBeCloseTo(0, 9);
  });

  it('never exceeds the configured top speed', () => {
    const state = run(createState(), 1800);
    const kinematics = vehicleKinematics(state);

    expect(kinematics.speed).toBeLessThanOrEqual(SCRAP_RUNNER.physics.maxForwardSpeed + 1e-9);
    expect(kinematics.speed).toBeGreaterThan(10);
    expect(kinematics.forwardSpeed).toBeGreaterThan(0);
  });

  it('brakes to a complete stop', () => {
    const moving = run(createState(), 120);
    expect(vehicleKinematics(moving).speed).toBeGreaterThan(5);

    const stopped = run(moving, 180, controls({ brake: 1 }));
    expect(vehicleKinematics(stopped).speed).toBeLessThan(0.01);
    expect(stopped.position.x).toBeGreaterThan(moving.position.x);
  });

  it('does not steer while stationary', () => {
    const state = run(createState(), 30, controls({ steer: 1, throttle: 0 }));

    expect(state.heading).toBeCloseTo(0, 9);
    expect(state.position.x).toBeCloseTo(0, 9);
    expect(state.position.y).toBeCloseTo(0, 9);
  });

  it('turns right (clockwise) when steer is positive', () => {
    const state = run(
      createState({ velocity: new Vec2(8, 0) }),
      30,
      controls({ steer: 1, throttle: 0 }),
    );

    expect(state.heading).toBeLessThan(-0.05);
    expect(state.position.y).toBeLessThan(0);
    expect(state.steering).toBeGreaterThan(0);
  });

  it('turns left (counter-clockwise) when steer is negative', () => {
    const state = run(
      createState({ velocity: new Vec2(8, 0) }),
      30,
      controls({ steer: -1, throttle: 0 }),
    );

    expect(state.heading).toBeGreaterThan(0.05);
    expect(state.position.y).toBeGreaterThan(0);
  });

  it('smooths steering towards the requested lock', () => {
    const state = stepVehicle(createState(), {
      config: SCRAP_RUNNER,
      arena: LARGE_ARENA,
      obstacles: [],
      controls: controls({ steer: 1 }),
      deltaSeconds: DT,
    });

    expect(state.steering).toBeCloseTo(SCRAP_RUNNER.physics.steerResponse * DT, 9);
  });

  it('keeps more lateral speed with the handbrake (drift)', () => {
    const start = createState({ velocity: new Vec2(8, 4) });
    const grip = run(start, 20, controls({ throttle: 0 }), {});
    const drift = run(start, 20, controls({ throttle: 0, handbrake: true }), {});

    const gripLateral = Math.abs(vehicleKinematics(grip).lateralSpeed);
    const driftLateral = Math.abs(vehicleKinematics(drift).lateralSpeed);
    expect(driftLateral).toBeGreaterThan(gripLateral * 3);
  });

  it('keeps the vehicle inside the arena bounds', () => {
    const arena: ArenaConfig = { halfWidth: 10, halfHeight: 10 };
    const state = run(
      createState({ position: new Vec2(9.9, 0), velocity: new Vec2(20, 0) }),
      120,
      controls({ throttle: 0 }),
      { arena },
    );
    const radius = SCRAP_RUNNER.collision.radius;

    expect(Math.abs(state.position.x)).toBeLessThanOrEqual(arena.halfWidth - radius + 1e-9);
    expect(Math.abs(state.position.y)).toBeLessThanOrEqual(arena.halfHeight - radius + 1e-9);
  });

  it('collides with obstacles instead of passing through', () => {
    const obstacle: ObstacleCircle = { id: 'rock', x: 5, y: 0, radius: 1 };
    const state = run(
      createState({ velocity: new Vec2(10, 0) }),
      180,
      controls({ throttle: 0 }),
      { obstacles: [obstacle] },
    );
    const distance = Math.hypot(state.position.x - obstacle.x, state.position.y - obstacle.y);
    const minimum = obstacle.radius + SCRAP_RUNNER.collision.radius;

    expect(distance).toBeGreaterThanOrEqual(minimum - 1e-6);
    expect(state.position.x).toBeLessThan(obstacle.x);
  });

  it('is deterministic for identical inputs', () => {
    const make = (): VehicleState =>
      createState({ position: new Vec2(3, -2), velocity: new Vec2(6, 1), heading: 0.4 });
    const obstacles: readonly ObstacleCircle[] = [{ id: 'a', x: 12, y: 3, radius: 2 }];

    const first = run(make(), 300, controls({ steer: -1 }), { obstacles });
    const second = run(make(), 300, controls({ steer: -1 }), { obstacles });

    expect(first).toEqual(second);
  });

  it('ignores non-positive or non-finite deltas', () => {
    const state = createState({ velocity: new Vec2(3, 0) });
    for (const deltaSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        stepVehicle(state, {
          config: SCRAP_RUNNER,
          arena: LARGE_ARENA,
          obstacles: [],
          controls: AUTO_DRIVE_CONTROLS,
          deltaSeconds,
        }),
      ).toBe(state);
    }
  });

  describe('reverse gear', () => {
    it('backs up when reverse is held from a standstill', () => {
      const state = run(createState(), 60, controls({ throttle: 0, reverse: 1 }));
      expect(vehicleKinematics(state).forwardSpeed).toBeLessThan(0);
      expect(state.position.x).toBeLessThan(0);
    });

    it('never exceeds maxReverseSpeed', () => {
      const state = run(createState(), 600, controls({ throttle: 0, reverse: 1 }));
      const speed = -vehicleKinematics(state).forwardSpeed;
      expect(speed).toBeLessThanOrEqual(SCRAP_RUNNER.physics.maxReverseSpeed + 0.05);
    });

    it('brakes out of forward motion before reversing', () => {
      let state = createState({ velocity: new Vec2(12, 0) });
      let sawBraking = false;
      for (let i = 0; i < 240; i += 1) {
        const before = vehicleKinematics(state).forwardSpeed;
        state = stepVehicle(state, {
          config: SCRAP_RUNNER,
          arena: LARGE_ARENA,
          obstacles: [],
          controls: controls({ throttle: 0, reverse: 1 }),
          deltaSeconds: DT,
        });
        const after = vehicleKinematics(state).forwardSpeed;
        if (before > 0 && after >= 0) sawBraking = true;
      }
      expect(sawBraking).toBe(true);
      expect(vehicleKinematics(state).forwardSpeed).toBeLessThan(0);
    });

    it('inverts steering direction while reversing', () => {
      // Like a real car: turning the wheel right reverses the nose left.
      const forwardTurn = run(
        createState({ velocity: new Vec2(6, 0) }),
        60,
        controls({ steer: 1, throttle: 1 }),
      );
      const reverseTurn = run(
        createState({ velocity: new Vec2(-3, 0) }),
        60,
        controls({ steer: 1, throttle: 0, reverse: 1 }),
      );
      const turnSign = (heading: number): number =>
        Math.sign(Math.atan2(Math.sin(heading), Math.cos(heading)));
      expect(turnSign(reverseTurn.heading)).toBe(-turnSign(forwardTurn.heading));
    });
  });
});

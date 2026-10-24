import { createDriveControls, type DriveControls } from '../sim/input/DriveCommand';
import { IDLE_TOUCH_INPUT, type TouchInputState } from '../ui/TouchControls';

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
/**
 * S / ArrowDown brake and, once the car has stopped, engage reverse.
 *
 * There is no separate keyboard brake because the reverse branch in
 * `stepVehicle` already decelerates at full `brakeDeceleration` before backing
 * up — pressing S therefore feels identical to braking, then continues into
 * reverse. X engages reverse directly without ever meaning "brake".
 */
const REVERSE_KEYS = new Set(['ArrowDown', 'KeyS', 'KeyX']);
const HANDBRAKE_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const INTERACT_KEYS = new Set(['KeyE', 'KeyF']);
/** Edge-triggered base actions: hold does nothing, each press acts once. */
const FOUND_BASE_KEYS = new Set(['KeyB']);
const BUILD_KEYS = new Set(['KeyV']);
const CYCLE_BASE_KEYS = new Set(['Tab']);

const HANDLED_KEYS = new Set([
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  ...REVERSE_KEYS,
  ...HANDBRAKE_KEYS,
  ...INTERACT_KEYS,
  ...FOUND_BASE_KEYS,
  ...BUILD_KEYS,
  ...CYCLE_BASE_KEYS,
]);

function isAnyPressed(keys: ReadonlySet<string>, candidates: ReadonlySet<string>): boolean {
  for (const code of candidates) {
    if (keys.has(code)) return true;
  }
  return false;
}

/**
 * Pure mapping from held keys to drive axes.
 *
 * Exported so the keyboard layout can be unit-tested without a DOM: the class
 * only adds touch merging and change detection on top.
 */
export function driveControlsFromKeys(pressed: ReadonlySet<string>): DriveControls {
  const left = isAnyPressed(pressed, LEFT_KEYS);
  const right = isAnyPressed(pressed, RIGHT_KEYS);
  const reverse = isAnyPressed(pressed, REVERSE_KEYS);
  const handbrake = isAnyPressed(pressed, HANDBRAKE_KEYS);
  const interact = isAnyPressed(pressed, INTERACT_KEYS);

  return createDriveControls({
    steer: (right ? 1 : 0) - (left ? 1 : 0),
    throttle: 1,
    brake: 0,
    reverse: reverse ? 1 : 0,
    handbrake,
    interact,
  });
}

function sameControls(a: DriveControls, b: DriveControls): boolean {
  return (
    a.steer === b.steer &&
    a.throttle === b.throttle &&
    a.brake === b.brake &&
    a.reverse === b.reverse &&
    a.handbrake === b.handbrake &&
    a.interact === b.interact &&
    a.foundBaseToken === b.foundBaseToken &&
    a.buildToken === b.buildToken &&
    a.cycleBaseToken === b.cycleBaseToken
  );
}

/**
 * Merges keyboard and touch input into a single drive-control state.
 *
 * The manager is stateless with respect to the simulation: it only reports
 * controls, and the composition root stamps them with a target tick.
 */
export class InputManager {
  readonly #onChange: (controls: DriveControls) => void;
  readonly #keys = new Set<string>();

  #touch: TouchInputState = IDLE_TOUCH_INPUT;
  #controls: DriveControls = createDriveControls();
  #foundBaseToken = 0;
  #buildToken = 0;
  #cycleBaseToken = 0;
  #attached = false;

  constructor(onChange: (controls: DriveControls) => void) {
    this.#onChange = onChange;
  }

  get controls(): DriveControls {
    return this.#controls;
  }

  attach(): void {
    if (this.#attached) return;
    this.#attached = true;
    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('keyup', this.#onKeyUp);
    window.addEventListener('blur', this.#onBlur);
  }

  detach(): void {
    if (!this.#attached) return;
    this.#attached = false;
    window.removeEventListener('keydown', this.#onKeyDown);
    window.removeEventListener('keyup', this.#onKeyUp);
    window.removeEventListener('blur', this.#onBlur);
  }

  setTouchState(state: TouchInputState): void {
    this.#touch = state;
    this.#emit();
  }

  reset(): void {
    this.#keys.clear();
    this.#touch = IDLE_TOUCH_INPUT;
    this.#emit();
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!HANDLED_KEYS.has(event.code)) return;

    event.preventDefault();
    if (event.repeat) return;
    this.#keys.add(event.code);

    // Action keys are counters, not held state: one key-down, one action.
    if (FOUND_BASE_KEYS.has(event.code)) this.#foundBaseToken += 1;
    if (BUILD_KEYS.has(event.code)) this.#buildToken += 1;
    if (CYCLE_BASE_KEYS.has(event.code)) this.#cycleBaseToken += 1;

    this.#emit();
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (!HANDLED_KEYS.has(event.code)) return;

    event.preventDefault();
    if (this.#keys.delete(event.code)) {
      this.#emit();
    }
  };

  readonly #onBlur = (): void => {
    if (this.#keys.size === 0) return;
    this.#keys.clear();
    this.#emit();
  };

  #emit(): void {
    // Keyboard axes come from one pure mapping; touch buttons are merged on
    // top so both paths still collapse into the same command model.
    const keys = driveControlsFromKeys(this.#keys);
    const touchSteer = (this.#touch.right ? 1 : 0) - (this.#touch.left ? 1 : 0);

    const next = createDriveControls({
      steer: keys.steer + touchSteer,
      throttle: keys.throttle,
      brake: this.#touch.brake ? 1 : 0,
      reverse: Math.max(keys.reverse, this.#touch.reverse ? 1 : 0),
      handbrake: keys.handbrake || this.#touch.handbrake,
      interact: keys.interact || this.#touch.interact,
      foundBaseToken: this.#foundBaseToken,
      buildToken: this.#buildToken,
      cycleBaseToken: this.#cycleBaseToken,
    });

    if (sameControls(next, this.#controls)) return;
    this.#controls = next;
    this.#onChange(next);
  }
}

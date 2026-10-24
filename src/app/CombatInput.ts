import type { AimControls, AimPoint } from '../sim/input/AimCommand';

type ToWorld = (clientX: number, clientY: number) => AimPoint | null;

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Mouse, keyboard and touch combat input.
 *
 * The class only collects intent and resolves the pointer to a world-space
 * aim point; the composition root stamps it with a simulation tick. Touch fire
 * comes from the on-screen button, mouse fire from the primary button, and
 * `F` provides a keyboard-only fire key.
 */
export class CombatInput {
  readonly #canvas: HTMLCanvasElement;
  readonly #toWorld: ToWorld;
  readonly #cleanups: (() => void)[] = [];

  #screenPoint: ScreenPoint | null = null;
  #mouseFire = false;
  #keyboardFire = false;
  #touchFire = false;
  #activeSlot = 0;
  #reloadToken = 0;
  #attached = false;

  constructor(canvas: HTMLCanvasElement, toWorld: ToWorld) {
    this.#canvas = canvas;
    this.#toWorld = toWorld;
  }

  get activeSlot(): number {
    return this.#activeSlot;
  }

  attach(): void {
    if (this.#attached) return;
    this.#attached = true;

    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('contextmenu', this.#onContextMenu);
    window.addEventListener('pointerup', this.#onWindowPointerUp);
    window.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('keyup', this.#onKeyUp);
    window.addEventListener('blur', this.#onBlur);

    this.#cleanups.push(
      () => this.#canvas.removeEventListener('pointermove', this.#onPointerMove),
      () => this.#canvas.removeEventListener('pointerdown', this.#onPointerDown),
      () => this.#canvas.removeEventListener('pointerup', this.#onPointerUp),
      () => this.#canvas.removeEventListener('contextmenu', this.#onContextMenu),
      () => window.removeEventListener('pointerup', this.#onWindowPointerUp),
      () => window.removeEventListener('keydown', this.#onKeyDown),
      () => window.removeEventListener('keyup', this.#onKeyUp),
      () => window.removeEventListener('blur', this.#onBlur),
    );
  }

  detach(): void {
    if (!this.#attached) return;
    this.#attached = false;
    for (const cleanup of this.#cleanups) cleanup();
    this.#cleanups.length = 0;
  }

  setTouchFire(fire: boolean): void {
    this.#touchFire = fire;
  }

  /** Current intent, resolved against the current camera transform. */
  poll(): AimControls {
    const aimPoint =
      this.#screenPoint !== null
        ? this.#toWorld(this.#screenPoint.x, this.#screenPoint.y)
        : null;

    return {
      aimPoint,
      fire: this.#mouseFire || this.#keyboardFire || this.#touchFire,
      activeSlot: this.#activeSlot,
      reloadToken: this.#reloadToken,
    };
  }

  reset(): void {
    this.#screenPoint = null;
    this.#mouseFire = false;
    this.#keyboardFire = false;
    this.#touchFire = false;
  }

  readonly #onPointerMove = (event: PointerEvent): void => {
    this.#screenPoint = { x: event.clientX, y: event.clientY };
  };

  readonly #onPointerDown = (event: PointerEvent): void => {
    this.#screenPoint = { x: event.clientX, y: event.clientY };
    if (event.pointerType === 'mouse' && event.button === 0) {
      this.#mouseFire = true;
      event.preventDefault();
    }
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button === 0) {
      this.#mouseFire = false;
    }
  };

  readonly #onWindowPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button === 0) {
      this.#mouseFire = false;
    }
  };

  readonly #onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.code === 'Digit1' || event.code === 'Digit2') {
      event.preventDefault();
      this.#activeSlot = event.code === 'Digit1' ? 0 : 1;
      return;
    }
    if (event.code === 'KeyR') {
      event.preventDefault();
      if (!event.repeat) this.#reloadToken += 1;
      return;
    }
    if (event.code === 'KeyF') {
      event.preventDefault();
      this.#keyboardFire = true;
    }
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'KeyF') {
      this.#keyboardFire = false;
    }
  };

  readonly #onBlur = (): void => {
    this.#mouseFire = false;
    this.#keyboardFire = false;
    this.#touchFire = false;
  };
}

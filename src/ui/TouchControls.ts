export interface TouchInputState {
  readonly left: boolean;
  readonly right: boolean;
  readonly brake: boolean;
  readonly reverse: boolean;
  readonly fire: boolean;
  readonly handbrake: boolean;
  readonly interact: boolean;
}

export const IDLE_TOUCH_INPUT: TouchInputState = {
  left: false,
  right: false,
  brake: false,
  reverse: false,
  fire: false,
  handbrake: false,
  interact: false,
};

type TouchAction = 'left' | 'right' | 'brake' | 'reverse' | 'fire' | 'interact';

/**
 * On-screen driving controls. Buttons report pressed state through one
 * callback; the app converts it into the same tick-stamped commands used by
 * the keyboard, so both input paths share one simulation model.
 */
export class TouchControls {
  readonly #root: HTMLDivElement;
  readonly #parent: HTMLElement;
  readonly #onChange: (state: TouchInputState) => void;
  readonly #pressed = new Set<TouchAction>();
  readonly #cleanups: (() => void)[] = [];
  readonly #pointerHandlers = new Map<HTMLButtonElement, () => void>();

  #state: TouchInputState = IDLE_TOUCH_INPUT;

  constructor(parent: HTMLElement, onChange: (state: TouchInputState) => void) {
    this.#onChange = onChange;
    this.#parent = parent;
    this.#root = document.createElement('div');
    this.#root.className = 'touch-controls';
    this.#root.setAttribute('aria-label', 'Сенсорное управление');
    this.#root.innerHTML = `
      <div class="touch-controls__group">
        <button class="touch-controls__button" type="button" tabindex="-1"
          data-control="left" aria-label="Поворот влево">◀</button>
        <button class="touch-controls__button" type="button" tabindex="-1"
          data-control="right" aria-label="Поворот вправо">▶</button>
      </div>
      <div class="touch-controls__group">
        <button class="touch-controls__button touch-controls__button--brake" type="button" tabindex="-1"
          data-control="interact" aria-label="Добыча и разгрузка">ДЕЙСТВИЕ</button>
        <button class="touch-controls__button touch-controls__button--brake" type="button" tabindex="-1"
          data-control="reverse" aria-label="Задний ход">НАЗАД</button>
        <button class="touch-controls__button touch-controls__button--brake" type="button" tabindex="-1"
          data-control="brake" aria-label="Тормоз">ТОРМОЗ</button>
      </div>
    `;
    parent.append(this.#root);

    this.#root.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
      const action = button.dataset.control as TouchAction;
      this.#bindButton(button, action);
    });

    const media = window.matchMedia('(pointer: coarse)');
    const updateVisibility = (): void => {
      const touchCapable = media.matches || navigator.maxTouchPoints > 0;
      this.#root.classList.toggle('touch-controls--visible', touchCapable);
      this.#parent.classList.toggle('hud--touch', touchCapable);
    };
    updateVisibility();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', updateVisibility);
      this.#cleanups.push(() => media.removeEventListener('change', updateVisibility));
    }
    this.#cleanups.push(() => this.#root.remove());
    this.#cleanups.push(() => this.#parent.classList.remove('hud--touch'));
  }

  get state(): TouchInputState {
    return this.#state;
  }

  get element(): HTMLElement {
    return this.#root;
  }

  dispose(): void {
    for (const cleanup of this.#pointerHandlers.values()) cleanup();
    this.#pointerHandlers.clear();
    for (const cleanup of this.#cleanups) cleanup();
    this.#cleanups.length = 0;
  }

  #bindButton(button: HTMLButtonElement, action: TouchAction): void {
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      this.#setPressed(action, true);
      button.classList.add('touch-controls__button--active');
    };
    const release = (event: PointerEvent): void => {
      event.preventDefault();
      this.#setPressed(action, false);
      button.classList.remove('touch-controls__button--active');
    };
    const contextMenu = (event: Event): void => {
      event.preventDefault();
    };

    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', contextMenu);

    this.#pointerHandlers.set(button, () => {
      button.removeEventListener('pointerdown', press);
      button.removeEventListener('pointerup', release);
      button.removeEventListener('pointercancel', release);
      button.removeEventListener('lostpointercapture', release);
      button.removeEventListener('contextmenu', contextMenu);
    });
  }

  #setPressed(action: TouchAction, pressed: boolean): void {
    const wasPressed = this.#pressed.has(action);
    if (pressed) {
      this.#pressed.add(action);
    } else {
      this.#pressed.delete(action);
    }
    if (pressed === wasPressed) return;

    this.#state = {
      left: this.#pressed.has('left'),
      right: this.#pressed.has('right'),
      brake: this.#pressed.has('brake'),
      reverse: this.#pressed.has('reverse'),
      fire: this.#pressed.has('fire'),
      handbrake: false,
      interact: this.#pressed.has('interact'),
    };
    this.#onChange(this.#state);
  }
}

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

export interface TouchControlsOptions {
  /** One-shot UI actions (slot selection, garage commands), not drive axes. */
  onAction?(action: string): void;
}

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
  readonly #onAction: (action: string) => void;
  readonly #actions: HTMLElement;
  readonly #pressed = new Set<TouchAction>();
  readonly #cleanups: (() => void)[] = [];
  readonly #pointerHandlers = new Map<HTMLButtonElement, () => void>();

  #state: TouchInputState = IDLE_TOUCH_INPUT;

  constructor(
    parent: HTMLElement,
    onChange: (state: TouchInputState) => void,
    options: TouchControlsOptions = {},
  ) {
    this.#onChange = onChange;
    this.#onAction = options.onAction ?? (() => undefined);
    this.#parent = parent;
    this.#root = document.createElement('div');
    this.#root.className = 'touch-controls';
    this.#root.setAttribute('aria-label', 'Сенсорное управление');
    this.#root.innerHTML = `
      <div class="touch-controls__actions" hidden>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="slot-1" aria-label="Орудие 1">ОР1</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="slot-2" aria-label="Орудие 2">ОР2</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="slot-3" aria-label="Модуль 1">МОД1</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="slot-4" aria-label="Модуль 2">МОД2</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="garage-install" aria-label="Установить модуль">СТАВИТЬ</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="garage-remove" aria-label="Снять модуль">СНЯТЬ</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="garage-engine" aria-label="Улучшить двигатель">ДВИГ</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="garage-chassis" aria-label="Улучшить корпус">КОРПУС</button>
        <button class="touch-controls__action" type="button" tabindex="-1"
          data-action="garage-workshop" aria-label="Улучшить мастерскую">МАСТ.</button>
      </div>
      <div class="touch-controls__group">
        <button class="touch-controls__button" type="button" tabindex="-1"
          data-control="left" aria-label="Поворот влево">◀</button>
        <button class="touch-controls__button" type="button" tabindex="-1"
          data-control="right" aria-label="Поворот вправо">▶</button>
      </div>
      <div class="touch-controls__group">
        <button class="touch-controls__button touch-controls__button--fire" type="button" tabindex="-1"
          data-control="fire" aria-label="Огонь">ОГОНЬ</button>
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
    this.#actions = this.#query('.touch-controls__actions');
    this.#root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      this.#bindAction(button);
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

  /** Garage-only actions appear only while the garage panel is open. */
  setGarageVisible(visible: boolean): void {
    this.#actions.hidden = !visible;
  }

  #query<T extends HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`touch control missing: ${selector}`);
    return element;
  }

  dispose(): void {
    for (const cleanup of this.#pointerHandlers.values()) cleanup();
    this.#pointerHandlers.clear();
    for (const cleanup of this.#cleanups) cleanup();
    this.#cleanups.length = 0;
  }

  #bindAction(button: HTMLButtonElement): void {
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      button.classList.add('touch-controls__button--active');
      const action = button.dataset.action;
      if (action) this.#onAction(action);
    };
    const release = (event: PointerEvent): void => {
      event.preventDefault();
      button.classList.remove('touch-controls__button--active');
    };
    const contextMenu = (event: Event): void => event.preventDefault();

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

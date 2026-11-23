/** Master switch for driving, available on desktop and touch layouts. */
export class DriveToggle {
  readonly #root: HTMLButtonElement;
  readonly #onChange: (enabled: boolean) => void;

  #enabled = false;

  constructor(parent: HTMLElement, onChange: (enabled: boolean) => void) {
    this.#onChange = onChange;
    this.#root = document.createElement('button');
    this.#root.type = 'button';
    this.#root.className = 'drive-toggle';
    this.#root.setAttribute('aria-pressed', 'false');
    this.#root.addEventListener('click', () => this.toggle());
    this.#render();
    parent.append(this.#root);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Keyboard, touch and debug paths all go through this one toggle. */
  toggle(): boolean {
    this.setEnabled(!this.#enabled);
    this.#onChange(this.#enabled);
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#render();
  }

  dispose(): void {
    this.#root.remove();
  }

  #render(): void {
    this.#root.textContent = this.#enabled ? 'ДВИЖЕНИЕ: ВКЛ' : 'ДВИЖЕНИЕ: ВЫКЛ';
    this.#root.classList.toggle('drive-toggle--on', this.#enabled);
    this.#root.setAttribute('aria-pressed', String(this.#enabled));
  }
}

import type { TestSceneDefinition, TestSceneId } from '../app/testScenes';

/** In-game scene switcher. Selection is handled by the composition root. */
export class ScenePicker {
  readonly #root: HTMLElement;
  readonly #close: HTMLButtonElement;
  readonly #onSelect: (id: TestSceneId | null) => void;

  #open = false;

  constructor(
    root: HTMLElement,
    scenes: readonly TestSceneDefinition[],
    activeId: TestSceneId,
    onSelect: (id: TestSceneId | null) => void,
  ) {
    this.#onSelect = onSelect;
    this.#root = document.createElement('section');
    this.#root.className = 'scene-picker';
    this.#root.hidden = true;
    this.#root.setAttribute('aria-label', 'Выбор сцены');

    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'ВЫБОР СЦЕНЫ';
    this.#close = document.createElement('button');
    this.#close.type = 'button';
    this.#close.className = 'scene-picker__close';
    this.#close.textContent = '×';
    this.#close.setAttribute('aria-label', 'Закрыть');
    this.#close.addEventListener('click', () => this.setOpen(false));
    header.append(title, this.#close);

    const hint = document.createElement('p');
    hint.className = 'scene-picker__hint';
    hint.textContent = 'Сцена перезагрузится со своим начальным состоянием.';

    const list = document.createElement('div');
    list.className = 'scene-picker__list';
    for (const scene of scenes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-picker__item';
      if (scene.id === activeId) {
        button.classList.add('scene-picker__item--active');
        button.setAttribute('aria-current', 'true');
      }
      const id = document.createElement('b');
      id.textContent = scene.id;
      const summary = document.createElement('span');
      summary.textContent = scene.summary;
      button.append(id, summary);
      button.addEventListener('click', () => this.#onSelect(scene.id));
      list.append(button);
    }

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'scene-picker__exit';
    exit.textContent = 'ВЫЙТИ В ОБЫЧНУЮ ИГРУ';
    exit.addEventListener('click', () => this.#onSelect(null));

    this.#root.append(header, hint, list, exit);
    root.append(this.#root);
  }

  get isOpen(): boolean {
    return this.#open;
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.#root.hidden = !open;
  }

  toggle(): void {
    this.setOpen(!this.#open);
  }

  dispose(): void {
    this.#root.remove();
  }
}

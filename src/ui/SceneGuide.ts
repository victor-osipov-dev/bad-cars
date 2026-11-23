import type { SceneGuideData } from '../app/testScenes';

/**
 * Collapsible in-game card with the manual test plan for the active scene.
 * Purely presentational: it never reads or mutates simulation state.
 */
export class SceneGuide {
  readonly #root: HTMLElement;
  readonly #toggle: HTMLButtonElement;
  readonly #body: HTMLElement;
  readonly #chevron: HTMLElement;
  readonly #hint: HTMLElement;

  #open = true;

  constructor(root: HTMLElement, title: string, data: SceneGuideData) {
    this.#root = document.createElement('section');
    this.#root.className = 'scene-guide';
    this.#root.setAttribute('aria-label', 'Справка по сцене');

    this.#toggle = document.createElement('button');
    this.#toggle.type = 'button';
    this.#toggle.className = 'scene-guide__toggle';
    this.#toggle.setAttribute('aria-expanded', 'true');
    this.#chevron = document.createElement('span');
    this.#chevron.className = 'scene-guide__chevron';
    this.#chevron.textContent = '▾';
    const heading = document.createElement('strong');
    heading.textContent = 'СПРАВКА ПО СЦЕНЕ';
    this.#hint = document.createElement('small');
    this.#hint.textContent = 'I — СВЕРНУТЬ';
    this.#toggle.append(this.#chevron, heading, this.#hint);
    this.#toggle.addEventListener('click', () => this.toggle());

    this.#body = document.createElement('div');
    this.#body.className = 'scene-guide__body';
    const sceneTitle = document.createElement('p');
    sceneTitle.className = 'scene-guide__scene';
    sceneTitle.textContent = title;
    this.#body.append(sceneTitle);
    this.#body.append(this.#section('ЦЕЛЬ', data.goal));
    this.#body.append(this.#section('ПРОВЕРЯЕТСЯ', data.mechanics));
    this.#body.append(this.#section('СТАРТ', data.start));

    const steps = document.createElement('section');
    steps.className = 'scene-guide__section';
    const stepsTitle = document.createElement('h4');
    stepsTitle.textContent = 'ЧТО СДЕЛАТЬ';
    const list = document.createElement('ol');
    for (const step of data.steps) {
      const item = document.createElement('li');
      item.textContent = step;
      list.append(item);
    }
    steps.append(stepsTitle, list);
    this.#body.append(steps);

    this.#body.append(this.#section('ОЖИДАЕМОЕ ПОВЕДЕНИЕ', data.expected));
    this.#body.append(this.#section('НЕ ПОКРЫВАЕТ', data.notCovered));

    this.#root.append(this.#toggle, this.#body);
    root.append(this.#root);
  }

  #section(label: string, text: string): HTMLElement {
    const section = document.createElement('section');
    section.className = 'scene-guide__section';
    const title = document.createElement('h4');
    title.textContent = label;
    const body = document.createElement('p');
    body.textContent = text;
    section.append(title, body);
    return section;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  setOpen(open: boolean): void {
    if (this.#open === open) return;
    this.#open = open;
    this.#body.hidden = !open;
    this.#toggle.setAttribute('aria-expanded', String(open));
    this.#chevron.textContent = open ? '▾' : '▸';
    this.#hint.textContent = open ? 'I — СВЕРНУТЬ' : 'I — РАЗВЕРНУТЬ';
  }

  toggle(): void {
    this.setOpen(!this.#open);
  }

  dispose(): void {
    this.#root.remove();
  }
}

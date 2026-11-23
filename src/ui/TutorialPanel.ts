/** Large, minimal step card that replaces the old wall-of-text control hint. */
export class TutorialPanel {
  readonly #root: HTMLElement;
  readonly #step: HTMLElement;
  readonly #counter: HTMLElement;
  readonly #title: HTMLElement;
  readonly #text: HTMLElement;
  readonly #skip: HTMLButtonElement;

  constructor(parent: HTMLElement, onSkip: () => void) {
    this.#root = document.createElement('section');
    this.#root.className = 'tutorial';
    this.#root.setAttribute('aria-label', 'Пошаговое обучение');

    const head = document.createElement('div');
    head.className = 'tutorial__head';
    const label = document.createElement('strong');
    label.textContent = 'ОБУЧЕНИЕ';
    this.#counter = document.createElement('span');
    head.append(label, this.#counter);

    this.#step = document.createElement('div');
    this.#step.className = 'tutorial__step';
    this.#title = document.createElement('b');
    this.#text = document.createElement('p');
    this.#step.append(this.#title, this.#text);

    this.#skip = document.createElement('button');
    this.#skip.type = 'button';
    this.#skip.className = 'tutorial__skip';
    this.#skip.addEventListener('click', onSkip);

    this.#root.append(head, this.#step, this.#skip);
    parent.append(this.#root);
  }

  render(
    title: string,
    text: string,
    index: number,
    total: number,
    complete: boolean,
  ): void {
    this.#counter.textContent = complete ? 'ГОТОВО' : `${index + 1} / ${total}`;
    this.#title.textContent = complete ? 'ОБУЧЕНИЕ ЗАВЕРШЕНО' : title;
    this.#text.textContent = complete
      ? 'Все шаги пройдены. Выходи в обычную игру через меню сцен.'
      : text;
    this.#skip.textContent = complete ? 'ЗАНОВО' : 'ПРОПУСТИТЬ →';
  }

  dispose(): void {
    this.#root.remove();
  }
}

export type TutorialPhaseState = 'done' | 'active' | 'todo';

export interface TutorialPhaseView {
  readonly label: string;
  readonly state: TutorialPhaseState;
}

export interface TutorialPanelModel {
  readonly title: string;
  readonly hint: string;
  readonly key: string;
  readonly goal: string;
  readonly index: number;
  readonly total: number;
  readonly complete: boolean;
  readonly phases: readonly TutorialPhaseView[];
}

/**
 * Large single-action card. Shows the phase rail, one key chip and one short
 * instruction, so the player always sees exactly the next action.
 */
export class TutorialPanel {
  readonly #root: HTMLElement;
  readonly #counter: HTMLElement;
  readonly #goal: HTMLElement;
  readonly #phaseChips: HTMLElement[] = [];
  readonly #key: HTMLElement;
  readonly #title: HTMLElement;
  readonly #hint: HTMLElement;
  readonly #progressFill: HTMLElement;
  readonly #skip: HTMLButtonElement;
  #flashTimer: number | null = null;

  constructor(
    parent: HTMLElement,
    phaseLabels: readonly string[],
    onSkip: () => void,
  ) {
    this.#root = document.createElement('section');
    this.#root.className = 'tutorial';
    this.#root.setAttribute('aria-label', 'Пошаговое обучение');
    this.#root.setAttribute('aria-live', 'polite');

    const head = document.createElement('div');
    head.className = 'tutorial__head';
    const label = document.createElement('strong');
    label.textContent = 'ОБУЧЕНИЕ';
    this.#counter = document.createElement('span');
    this.#counter.className = 'tutorial__counter';
    head.append(label, this.#counter);

    const goals = document.createElement('div');
    goals.className = 'tutorial__goal';

    const phases = document.createElement('div');
    phases.className = 'tutorial__phases';
    for (const phaseLabel of phaseLabels) {
      const chip = document.createElement('span');
      chip.className = 'tutorial__phase';
      chip.textContent = phaseLabel;
      phases.append(chip);
      this.#phaseChips.push(chip);
    }

    const main = document.createElement('div');
    main.className = 'tutorial__main';
    this.#key = document.createElement('div');
    this.#key.className = 'tutorial__key';
    const copy = document.createElement('div');
    copy.className = 'tutorial__copy';
    this.#title = document.createElement('b');
    this.#title.className = 'tutorial__title';
    this.#hint = document.createElement('p');
    this.#hint.className = 'tutorial__hint';
    copy.append(this.#title, this.#hint);
    main.append(this.#key, copy);

    const progress = document.createElement('div');
    progress.className = 'tutorial__progress';
    this.#progressFill = document.createElement('div');
    this.#progressFill.className = 'tutorial__progress-fill';
    progress.append(this.#progressFill);

    this.#goal = goals;
    this.#skip = document.createElement('button');
    this.#skip.type = 'button';
    this.#skip.className = 'tutorial__skip';
    this.#skip.addEventListener('click', onSkip);

    this.#root.append(head, phases, this.#goal, main, progress, this.#skip);
    parent.append(this.#root);
  }

  render(model: TutorialPanelModel): void {
    this.#counter.textContent = model.complete
      ? 'ГОТОВО'
      : `ШАГ ${model.index + 1} / ${model.total}`;
    this.#goal.textContent = model.complete ? 'ЦЕЛЬ: ЦИКЛ ОСВОЕН' : `ЦЕЛЬ: ${model.goal}`;
    this.#key.textContent = model.complete ? '✓' : model.key;
    this.#key.classList.toggle('tutorial__key--done', model.complete);
    this.#title.textContent = model.complete ? 'ТЫ ГОТОВ' : model.title;
    this.#hint.textContent = model.complete
      ? 'Добыча → база → бой. Нажми «ЗАНОВО», чтобы повторить.'
      : model.hint;
    this.#progressFill.style.width = model.complete
      ? '100%'
      : `${Math.round((model.index / Math.max(1, model.total)) * 100)}%`;

    model.phases.forEach((phase, index) => {
      const chip = this.#phaseChips[index];
      if (!chip) return;
      chip.textContent = phase.label;
      chip.classList.toggle('tutorial__phase--done', phase.state === 'done');
      chip.classList.toggle('tutorial__phase--active', phase.state === 'active');
    });

    this.#skip.textContent = model.complete ? 'ЗАНОВО' : 'ПРОПУСТИТЬ ШАГ →';
  }

  /** Brief green pulse confirming that a step was completed. */
  flashStepDone(): void {
    this.#root.classList.remove('tutorial--done');
    // Restart the animation even when two steps complete in quick succession.
    void this.#root.offsetWidth;
    this.#root.classList.add('tutorial--done');
    if (this.#flashTimer !== null) window.clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      this.#root.classList.remove('tutorial--done');
      this.#flashTimer = null;
    }, 550);
  }

  dispose(): void {
    if (this.#flashTimer !== null) window.clearTimeout(this.#flashTimer);
    this.#root.remove();
  }
}

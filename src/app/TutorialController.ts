import type { WorldSnapshot, WorldState } from '../sim/world/WorldState';
import { TutorialPanel, type TutorialPhaseState } from '../ui/TutorialPanel';
import {
  captureBaseline,
  TUTORIAL_PHASES,
  TUTORIAL_STEPS,
  type TutorialBaseline,
  type TutorialContext,
  type TutorialPhase,
} from './tutorialSteps';

export interface TutorialContextSource {
  driveEnabled(): boolean;
  snapshot(): WorldSnapshot;
  world(): WorldState;
}

/** Advances the tutorial by observing ordinary gameplay state; no new logic. */
export class TutorialController {
  readonly #source: TutorialContextSource;
  readonly #panel: TutorialPanel;
  #index = 0;
  #complete = false;
  #baseline: TutorialBaseline;

  constructor(parent: HTMLElement, source: TutorialContextSource) {
    this.#source = source;
    this.#panel = new TutorialPanel(
      parent,
      TUTORIAL_PHASES.map((phase) => phase.label),
      () => this.#skip(),
    );
    this.#baseline = captureBaseline(this.#context());
    this.#render();
  }

  update(): void {
    if (this.#complete) return;
    const step = TUTORIAL_STEPS[this.#index];
    if (!step) return;
    if (step.done(this.#context(), this.#baseline)) {
      this.#advance();
      this.#panel.flashStepDone();
      this.#render();
    }
  }

  /** Bay the garage panel should highlight for the current step. */
  get garageHintSlot(): number | null {
    if (this.#complete) return null;
    return TUTORIAL_STEPS[this.#index]?.highlightSlot ?? null;
  }

  dispose(): void {
    this.#panel.dispose();
  }

  #context(): TutorialContext {
    return {
      driveEnabled: this.#source.driveEnabled(),
      snapshot: this.#source.snapshot(),
      world: this.#source.world(),
    };
  }

  #skip(): void {
    if (this.#complete) {
      this.#index = 0;
      this.#complete = false;
      this.#baseline = captureBaseline(this.#context());
    } else {
      this.#advance();
    }
    this.#render();
  }

  #advance(): void {
    this.#index += 1;
    if (this.#index >= TUTORIAL_STEPS.length) {
      this.#complete = true;
      return;
    }
    this.#baseline = captureBaseline(this.#context());
  }

  #phaseState(phase: TutorialPhase): TutorialPhaseState {
    if (this.#complete) return 'done';
    const current = TUTORIAL_STEPS[this.#index]?.phase;
    if (!current) return 'done';
    const currentIndex = TUTORIAL_PHASES.findIndex((entry) => entry.id === current);
    const index = TUTORIAL_PHASES.findIndex((entry) => entry.id === phase);
    if (index < currentIndex) return 'done';
    if (index === currentIndex) return 'active';
    return 'todo';
  }

  #render(): void {
    const step = TUTORIAL_STEPS[this.#index];
    this.#panel.render({
      title: step?.title ?? '',
      hint: step?.hint ?? '',
      key: step?.key ?? '',
      goal: TUTORIAL_PHASES.find((phase) => phase.id === step?.phase)?.goal ?? '',
      index: this.#index,
      total: TUTORIAL_STEPS.length,
      complete: this.#complete,
      phases: TUTORIAL_PHASES.map((phase) => ({
        label: phase.label,
        state: this.#phaseState(phase.id),
      })),
    });
  }
}

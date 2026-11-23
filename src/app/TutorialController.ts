import type { WorldSnapshot, WorldState } from '../sim/world/WorldState';
import { TutorialPanel } from '../ui/TutorialPanel';
import {
  captureBaseline,
  TUTORIAL_STEPS,
  type TutorialBaseline,
  type TutorialContext,
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
    this.#panel = new TutorialPanel(parent, () => this.#skip());
    this.#baseline = captureBaseline(this.#context());
    this.#render();
  }

  update(): void {
    if (this.#complete) return;
    const step = TUTORIAL_STEPS[this.#index];
    if (!step) return;
    if (step.done(this.#context(), this.#baseline)) this.#advance();
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

  #render(): void {
    const step = TUTORIAL_STEPS[this.#index];
    this.#panel.render(
      step?.title ?? '',
      step?.text ?? '',
      this.#index,
      TUTORIAL_STEPS.length,
      this.#complete,
    );
  }
}

/**
 * Frame budget instrumentation for the presentation layer.
 *
 * Simulation code never measures wall-clock time; the render loop owns this
 * profiler. Values are exponential moving averages so the HUD stays readable
 * without allocating arrays or growing memory during long sessions.
 */

export interface FrameSample {
  /** Real time between frames, in seconds. */
  readonly frameSeconds: number;
  /** Time spent advancing the fixed-step simulation. */
  readonly simSeconds: number;
  /** Time spent building the render snapshot and syncing meshes. */
  readonly syncSeconds: number;
  /** Time spent in scene.render(). */
  readonly renderSeconds: number;
  /** Simulation time deliberately dropped by the fixed-step driver. */
  readonly droppedSeconds?: number;
}

export interface FrameStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly simMs: number;
  readonly syncMs: number;
  readonly renderMs: number;
  /** Sum of sim + sync + render against a 60 Hz budget (16.67 ms). */
  readonly budgetRatio: number;
  readonly droppedSeconds: number;
  readonly samples: number;
}

const FRAME_BUDGET_MS = 1000 / 60;
const SMOOTHING = 0.12;

function nonNegative(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : 0;
}

export class FrameProfiler {
  #frameMs = 0;
  #simMs = 0;
  #syncMs = 0;
  #renderMs = 0;
  #droppedSeconds = 0;
  #samples = 0;

  sample(sample: FrameSample): void {
    const frameMs = nonNegative(sample.frameSeconds) * 1000;
    if (frameMs <= 0) return;

    this.#samples += 1;
    this.#frameMs = this.#blend(this.#frameMs, frameMs);
    this.#simMs = this.#blend(this.#simMs, nonNegative(sample.simSeconds) * 1000);
    this.#syncMs = this.#blend(this.#syncMs, nonNegative(sample.syncSeconds) * 1000);
    this.#renderMs = this.#blend(this.#renderMs, nonNegative(sample.renderSeconds) * 1000);
    this.#droppedSeconds += nonNegative(sample.droppedSeconds);
  }

  reset(): void {
    this.#frameMs = 0;
    this.#simMs = 0;
    this.#syncMs = 0;
    this.#renderMs = 0;
    this.#droppedSeconds = 0;
    this.#samples = 0;
  }

  get stats(): FrameStats {
    const workMs = this.#simMs + this.#syncMs + this.#renderMs;
    return {
      fps: this.#frameMs > 0 ? 1000 / this.#frameMs : 0,
      frameMs: this.#frameMs,
      simMs: this.#simMs,
      syncMs: this.#syncMs,
      renderMs: this.#renderMs,
      budgetRatio: workMs / FRAME_BUDGET_MS,
      droppedSeconds: this.#droppedSeconds,
      samples: this.#samples,
    };
  }

  #blend(previous: number, next: number): number {
    return previous === 0 ? next : previous + (next - previous) * SMOOTHING;
  }
}

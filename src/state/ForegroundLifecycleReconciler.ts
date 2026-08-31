import type { DemoOccurrence } from '../features/demoApi';

type TimerHandle = ReturnType<typeof setTimeout>;

type Dependencies = {
  now(): number;
  reconcile(): Promise<void>;
  occurrences(): DemoOccurrence[];
  setTimer(callback: () => void, delayMs: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
};

export class ForegroundLifecycleReconciler {
  private active = false;
  private running = false;
  private timer: TimerHandle | undefined;

  constructor(private readonly dependencies: Dependencies) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.schedule(0);
  }

  stop(): void {
    this.active = false;
    if (this.timer) this.dependencies.clearTimer(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number): void {
    if (!this.active) return;
    if (this.timer) this.dependencies.clearTimer(this.timer);
    this.timer = this.dependencies.setTimer(() => void this.run(), delayMs);
  }

  private async run(): Promise<void> {
    this.timer = undefined;
    if (!this.active || this.running) return;
    this.running = true;
    try {
      await this.dependencies.reconcile();
    } catch {
      // A transient reconciliation failure is retried by the next boundary/watchdog tick.
    } finally {
      this.running = false;
      if (this.active) this.schedule(this.nextDelay());
    }
  }

  private nextDelay(): number {
    const now = this.dependencies.now();
    const boundaries = this.dependencies.occurrences().flatMap((occurrence) => {
      const candidates: number[] = [];
      if (occurrence.lifecycle === 'scheduled') candidates.push(Date.parse(occurrence.plannedAt));
      if (['scheduled', 'due', 'prepared'].includes(occurrence.lifecycle)) {
        candidates.push(Date.parse(occurrence.recordUntilAt));
      }
      return candidates.filter((value) => Number.isFinite(value) && value > now);
    });
    const nextBoundary = boundaries.length ? Math.min(...boundaries) : Number.POSITIVE_INFINITY;
    return Math.min(60_000, Math.max(250, nextBoundary - now + 250));
  }
}

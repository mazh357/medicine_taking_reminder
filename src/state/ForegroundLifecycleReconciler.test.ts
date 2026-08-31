import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DemoOccurrence } from '../features/demoApi';
import { ForegroundLifecycleReconciler } from './ForegroundLifecycleReconciler';

function occurrence(): DemoOccurrence {
  return {
    id: 'occurrence-1', localServiceDate: '2026-08-26',
    plannedAt: '2026-08-26T08:01:00.000Z', onTimeUntilAt: '2026-08-26T09:01:00.000Z',
    recordUntilAt: '2026-08-26T20:01:00.000Z', lifecycle: 'scheduled', preparedAt: null,
    completedAt: null, photo: null, items: [],
  };
}

afterEach(() => vi.useRealTimers());

describe('foreground lifecycle reconciler', () => {
  it('reconciles immediately, at the next boundary and at most once concurrently', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-26T08:00:00.000Z');
    const reconcile = vi.fn(async () => undefined);
    const controller = new ForegroundLifecycleReconciler({
      now: () => Date.now(), reconcile, occurrences: () => [occurrence()],
      setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: clearTimeout,
    });
    controller.start();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(reconcile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_250);
    expect(reconcile).toHaveBeenCalledTimes(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});

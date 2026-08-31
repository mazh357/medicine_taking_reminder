import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_OBJECT_COUNT_TIMEOUT_MS,
  DemoPillCounterAdapter,
} from './DemoPillCounterAdapter';

describe('DemoPillCounterAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps native exceptions and malformed results to processing_error', async () => {
    const throwing = new DemoPillCounterAdapter({
      countObjects: async () => {
        throw new Error('native unavailable');
      },
    });
    await expect(throwing.countObjects('file:///photo.jpg')).resolves.toEqual({
      status: 'unable',
      reason: 'processing_error',
    });

    const malformed = new DemoPillCounterAdapter({
      countObjects: async () => ({
        status: 'counted',
        detectedObjectCount: Number.NaN,
        quality: 'acceptable',
      }),
    });
    await expect(malformed.countObjects('file:///photo.jpg')).resolves.toEqual({
      status: 'unable',
      reason: 'processing_error',
    });
  });

  it('returns only a count observation and validated boxes', async () => {
    const adapter = new DemoPillCounterAdapter({
      countObjects: async () => ({
        status: 'counted',
        detectedObjectCount: 3,
        quality: 'acceptable',
        boxes: [
          { x: 1, y: 2, width: 3, height: 4 },
          { x: 0, y: 0, width: -1, height: 4 },
        ],
      }),
    });
    await expect(adapter.countObjects('content://camera/photo')).resolves.toEqual({
      status: 'counted',
      detectedObjectCount: 3,
      quality: 'acceptable',
      boxes: [{ x: 1, y: 2, width: 3, height: 4 }],
    });
  });

  it('accepts temporary local file and content URIs without extension assumptions', async () => {
    const received: string[] = [];
    const adapter = new DemoPillCounterAdapter({
      countObjects: async (photoUri) => {
        received.push(photoUri);
        return {
          status: 'unable',
          reason: 'low_contrast',
        };
      },
    });

    await adapter.countObjects('file:///data/user/0/app/cache/decrypted/7f91a2');
    await adapter.countObjects(
      'content://com.helpusurvive.medicationdemo.decrypted/temporary/9?token=short-lived',
    );

    expect(received).toEqual([
      'file:///data/user/0/app/cache/decrypted/7f91a2',
      'content://com.helpusurvive.medicationdemo.decrypted/temporary/9?token=short-lived',
    ]);
  });

  it('maps a configurable native timeout to processing_error and ignores a late result', async () => {
    vi.useFakeTimers();
    let resolveNative: ((result: {
      status: 'counted';
      detectedObjectCount: number;
      quality: 'acceptable';
    }) => void) | undefined;
    const adapter = new DemoPillCounterAdapter(
      {
        countObjects: () => new Promise((resolve) => {
          resolveNative = resolve;
        }),
      },
      { timeoutMs: 25 },
    );

    const observation = adapter.countObjects('content://temporary/photo');
    await vi.advanceTimersByTimeAsync(25);
    await expect(observation).resolves.toEqual({
      status: 'unable',
      reason: 'processing_error',
    });

    resolveNative?.({
      status: 'counted',
      detectedObjectCount: 2,
      quality: 'acceptable',
    });
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a fixed three-second default and clears the timer after fast success', async () => {
    expect(DEFAULT_OBJECT_COUNT_TIMEOUT_MS).toBe(3_000);
    vi.useFakeTimers();
    const adapter = new DemoPillCounterAdapter({
      countObjects: async () => ({
        status: 'counted',
        detectedObjectCount: 1,
        quality: 'acceptable',
      }),
    });

    await expect(adapter.countObjects('file:///temporary/photo')).resolves.toEqual({
      status: 'counted',
      detectedObjectCount: 1,
      quality: 'acceptable',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid timeout configuration before native work starts', () => {
    expect(() => new DemoPillCounterAdapter(
      { countObjects: async () => ({ status: 'unable', reason: 'processing_error' }) },
      { timeoutMs: 0 },
    )).toThrow(RangeError);
  });
});

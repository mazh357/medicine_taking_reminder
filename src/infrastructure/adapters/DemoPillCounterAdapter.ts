import type {
  CountUnableReason,
  DemoCountResult,
} from '../../features/demoApi';

interface NativeCountedResult {
  status: 'counted';
  detectedObjectCount: number;
  quality: 'acceptable';
  boxes?: { x: number; y: number; width: number; height: number }[];
}

interface NativeUnableResult {
  status: 'unable';
  reason: string;
}

export interface NativeObjectCounter {
  countObjects(photoUri: string): Promise<NativeCountedResult | NativeUnableResult>;
}

export interface DemoPillCounterAdapterOptions {
  /** Maximum time the UI-facing adapter waits for one native observation. */
  timeoutMs?: number;
}

/** Matches the documented P95 ceiling for one on-device analysis. */
export const DEFAULT_OBJECT_COUNT_TIMEOUT_MS = 3_000;

const KNOWN_REASONS = new Set<CountUnableReason>([
  'low_contrast',
  'blur',
  'overlap',
  'background_noise',
  'too_dark',
  'processing_error',
]);

function isValidBox(
  box: { x: number; y: number; width: number; height: number },
): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite) &&
    box.width >= 0 &&
    box.height >= 0;
}

/**
 * Defensive boundary around the native contour counter.
 *
 * This adapter returns an observation only. It has no reference to an
 * occurrence item, planned quantity, confirmation command, or inventory API,
 * so a counter result cannot accidentally become a consumption assertion.
 */
export class DemoPillCounterAdapter {
  private readonly timeoutMs: number;

  constructor(
    private readonly nativeCounter: NativeObjectCounter,
    options: DemoPillCounterAdapterOptions = {},
  ) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_OBJECT_COUNT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError('Object counter timeout must be a positive finite number.');
    }
    this.timeoutMs = timeoutMs;
  }

  async countObjects(photoUri: string): Promise<DemoCountResult> {
    try {
      if (!/^(file|content):\/\//i.test(photoUri)) return this.processingError();
      const result = await this.waitForNativeResult(photoUri);
      if (result.status === 'unable') {
        return {
          status: 'unable',
          reason: KNOWN_REASONS.has(result.reason as CountUnableReason)
            ? (result.reason as CountUnableReason)
            : 'processing_error',
        };
      }
      if (
        result.status !== 'counted' ||
        result.quality !== 'acceptable' ||
        !Number.isSafeInteger(result.detectedObjectCount) ||
        result.detectedObjectCount < 0 ||
        result.detectedObjectCount > 999
      ) {
        return this.processingError();
      }
      const boxes = result.boxes?.filter(isValidBox);
      return {
        status: 'counted',
        detectedObjectCount: result.detectedObjectCount,
        quality: 'acceptable',
        ...(boxes?.length ? { boxes } : {}),
      };
    } catch {
      return this.processingError();
    }
  }

  private processingError(): DemoCountResult {
    return { status: 'unable', reason: 'processing_error' };
  }

  private async waitForNativeResult(
    photoUri: string,
  ): Promise<NativeCountedResult | NativeUnableResult> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('Object counter timed out.')),
        this.timeoutMs,
      );
    });

    try {
      return await Promise.race([
        this.nativeCounter.countObjects(photoUri),
        timeout,
      ]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  }
}

/** Lazily loads the native module so unsupported runtimes degrade safely. */
export const lazyNativeObjectCounter: NativeObjectCounter = {
  async countObjects(photoUri) {
    const module = await import('../../../modules/demo-pill-counter');
    return module.default.countObjects(photoUri);
  },
};

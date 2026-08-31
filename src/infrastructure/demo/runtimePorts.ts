import type {
  Clock,
  IdGenerator,
  PayloadFingerprinter,
  ScheduleResolver,
} from '../../application';
import type { UtcInstant } from '../../domain';

export interface RandomBytesSource {
  bytes(length: number): Uint8Array;
}

/** Bind RandomBytesSource to a platform CSPRNG; this class never assumes global crypto exists. */
export class UuidV4IdGenerator implements IdGenerator {
  constructor(private readonly random: RandomBytesSource) {}

  next(): string {
    const bytes = this.random.bytes(16);
    if (bytes.length !== 16) throw new Error('RandomBytesSource must return exactly 16 bytes');
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

export class SystemClock implements Clock {
  now(): UtcInstant {
    return new Date().toISOString();
  }
}

/** Non-cryptographic conflict detector for internal Demo only; production must inject SHA-256. */
export class DemoPayloadFingerprinter implements PayloadFingerprinter {
  fingerprint(value: unknown): string {
    const text = stableStringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `demo-fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
}

/** Demo is frozen to one explicit fixed-offset zone; it must not silently accept other zones. */
export class FixedOffsetScheduleResolver implements ScheduleResolver {
  constructor(
    private readonly supportedTimeZone = 'Asia/Shanghai',
    private readonly offsetMinutes = 480,
  ) {}

  resolveDailySchedule(input: Parameters<ScheduleResolver['resolveDailySchedule']>[0]) {
    if (input.timeZone !== this.supportedTimeZone) {
      throw new Error(`Unsupported Demo time zone: ${input.timeZone}`);
    }
    const [year, month, day] = input.localDate.split('-').map(Number) as [number, number, number];
    const [hour, minute] = input.localTime.split(':').map(Number) as [number, number];
    const scheduledMs = Date.UTC(year, month - 1, day, hour, minute) - this.offsetMinutes * 60_000;
    return {
      scheduledAtUtc: new Date(scheduledMs).toISOString(),
      onTimeUntilAtUtc: new Date(scheduledMs + input.onTimeOffsetMinutes * 60_000).toISOString(),
      recordUntilAtUtc: new Date(scheduledMs + input.recordOffsetMinutes * 60_000).toISOString(),
    };
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`;
}

import type {
  Clock,
  IdGenerator,
  PayloadFingerprinter,
  ScheduleResolver,
} from '../../application';

export class RuntimeClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class RuntimeIdGenerator implements IdGenerator {
  next(): string {
    // Demo-local UUID v4. No network or device identifier is used. Math.random
    // is sufficient for fictitious Demo entity uniqueness; formal security
    // identifiers require the production cryptographic runtime decision.
    const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.map((value) => value.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(',')}}`;
}

/** Deterministic non-cryptographic fingerprint; Demo idempotency only. */
export class DemoPayloadFingerprinter implements PayloadFingerprinter {
  fingerprint(value: unknown): string {
    const text = canonicalize(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }
}

function partsInTimeZone(instant: number, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const result: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
}

function localWallTimeToUtc(localDate: string, localTime: string, timeZone: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  if ([year, month, day, hour, minute].some((value) => !Number.isInteger(value))) {
    throw new Error('Invalid local schedule');
  }
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!, 0, 0);
  let candidate = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = partsInTimeZone(candidate, timeZone);
    const represented = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
      parts.second!,
    );
    candidate -= represented - target;
  }
  return candidate;
}

export class IntlDailyScheduleResolver implements ScheduleResolver {
  resolveDailySchedule(input: {
    localDate: string;
    localTime: string;
    timeZone: string;
    onTimeOffsetMinutes: number;
    recordOffsetMinutes: number;
  }) {
    const scheduled = localWallTimeToUtc(input.localDate, input.localTime, input.timeZone);
    return {
      scheduledAtUtc: new Date(scheduled).toISOString(),
      onTimeUntilAtUtc: new Date(
        scheduled + input.onTimeOffsetMinutes * 60_000,
      ).toISOString(),
      recordUntilAtUtc: new Date(
        scheduled + input.recordOffsetMinutes * 60_000,
      ).toISOString(),
    };
  }
}

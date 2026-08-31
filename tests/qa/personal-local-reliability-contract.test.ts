import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FixedOffsetScheduleResolver } from '../../src/infrastructure/demo/runtimePorts';

describe('QA: personal local time reliability contracts', () => {
  it('keeps reminder input as a two-column 24-hour picker without keyboard text entry', () => {
    const source = readFileSync(resolve('src/ui/TimePickerField.tsx'), 'utf8');

    expect(source).toContain('Array.from({ length: 24 }');
    expect(source).toContain('Array.from({ length: 60 }');
    expect(source).toContain('label="小时"');
    expect(source).toContain('label="分钟"');
    expect(source).toContain('accessibilityRole="adjustable"');
    expect(source).toContain('onChange(`${pad(hour)}:${pad(minute)}`)');
    expect(source).not.toContain('TextInput');
  });

  it('keeps the local service date while a late record window crosses local midnight', () => {
    const resolver = new FixedOffsetScheduleResolver('Asia/Shanghai', 480);
    const schedule = resolver.resolveDailySchedule({
      localDate: '2026-12-31',
      localTime: '23:30',
      timeZone: 'Asia/Shanghai',
      onTimeOffsetMinutes: 30,
      recordOffsetMinutes: 120,
    });

    expect(schedule).toEqual({
      scheduledAtUtc: '2026-12-31T15:30:00.000Z',
      onTimeUntilAtUtc: '2026-12-31T16:00:00.000Z',
      recordUntilAtUtc: '2026-12-31T17:30:00.000Z',
    });
    const recordUntilInShanghai = new Date(
      Date.parse(schedule.recordUntilAtUtc) + 8 * 60 * 60 * 1000,
    ).toISOString();
    expect(recordUntilInShanghai).toBe('2027-01-01T01:30:00.000Z');
  });
});

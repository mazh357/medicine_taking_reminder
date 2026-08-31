import { describe, expect, it } from 'vitest';

import type { OccurrenceView } from './medicationAppApi';
import { resolveOccurrenceEntry } from './occurrenceEntryPolicy';

const NOW = Date.parse('2026-08-26T08:00:00.000Z');

function occurrence(overrides: Partial<OccurrenceView> = {}): OccurrenceView {
  return {
    id: 'occurrence-1',
    localServiceDate: '2026-08-26',
    plannedAt: '2026-08-26T08:00:00.000Z',
    onTimeUntilAt: '2026-08-26T09:00:00.000Z',
    recordUntilAt: '2026-08-26T20:00:00.000Z',
    lifecycle: 'due',
    preparedAt: null,
    completedAt: null,
    photo: null,
    photos: [],
    items: [{
      id: 'item-1', medicationId: 'med-1', displayName: '药物 A', quantityUnit: 'count',
      plannedDoseQuantity: 1, assertion: 'pending', confirmedConsumptionQuantity: null,
      confirmedAt: null, revisions: [],
    }],
    ...overrides,
  };
}

describe('occurrence entry policy', () => {
  it('requires confirmation before an early entry and captures stale scheduled tasks after time', () => {
    const future = occurrence({ lifecycle: 'scheduled', plannedAt: '2026-08-26T09:00:00.000Z' });
    expect(resolveOccurrenceEntry(future, NOW)).toBe('confirm_early');
    expect(resolveOccurrenceEntry(occurrence({ lifecycle: 'scheduled' }), NOW)).toBe('capture');
  });

  it('resumes confirmation when evidence exists, including a missed task', () => {
    const photo = {
      id: 'photo-1', occurrenceId: 'occurrence-1', state: 'captured' as const,
      capturePurpose: 'initial' as const, capturedAt: '2026-08-26T08:01:00.000Z',
      detectedObjectCount: null, countSource: null,
    };
    expect(resolveOccurrenceEntry(occurrence({ lifecycle: 'prepared', photo }), NOW)).toBe('confirm');
    expect(resolveOccurrenceEntry(occurrence({ lifecycle: 'missed', photo }), NOW)).toBe('confirm');
    expect(resolveOccurrenceEntry(occurrence({ lifecycle: 'missed' }), NOW)).toBe('capture');
  });

  it('opens history for completed and revoked tasks', () => {
    const completedItems = occurrence().items.map((item) => ({
      ...item, assertion: 'taken_as_planned' as const, confirmedConsumptionQuantity: 1,
    }));
    expect(resolveOccurrenceEntry(occurrence({ items: completedItems }), NOW)).toBe('history');
    expect(resolveOccurrenceEntry(occurrence({ lifecycle: 'revoked' }), NOW)).toBe('history');
  });
});

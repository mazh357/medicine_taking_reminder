import { describe, expect, it } from 'vitest';

import type { HistoryEntry, InventoryLedgerEntry } from '../../domain';
import { projectLedgerOccurrenceIds } from './inventoryOccurrenceProjection';

describe('projectLedgerOccurrenceIds', () => {
  it('links consumption and its reversal to the originating occurrence', () => {
    const consumption = {
      id: 'ledger-consumption',
      medicationId: 'med-1',
      entryType: 'consumption',
      quantityDelta: '-1',
      unit: 'tablet',
      sourceFactType: 'consumption_assertion',
      sourceFactId: 'fact-1',
      reversesEntryId: null,
      reasonCode: null,
      effectiveAtUtc: '2026-08-24T00:00:00.000Z',
      recordedAtUtc: '2026-08-24T00:00:00.000Z',
      commandId: 'command-1',
    } as InventoryLedgerEntry;
    const reversal = {
      ...consumption,
      id: 'ledger-reversal',
      entryType: 'reversal',
      quantityDelta: '1',
      sourceFactType: 'inventory_ledger',
      sourceFactId: consumption.id,
      reversesEntryId: consumption.id,
    } as InventoryLedgerEntry;
    const history = {
      occurrence: { id: 'occ-1' },
      assertionFacts: [{ id: 'fact-1' }],
      photos: [],
      countObservations: [],
      inventoryEntries: [consumption, reversal],
    } as unknown as HistoryEntry;

    const result = projectLedgerOccurrenceIds([consumption, reversal], [history]);
    expect(result.get(consumption.id)).toBe('occ-1');
    expect(result.get(reversal.id)).toBe('occ-1');
  });
});

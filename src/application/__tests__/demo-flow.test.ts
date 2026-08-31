import { describe, expect, it } from 'vitest';

import { DemoApplicationService } from '../DemoApplicationService';
import {
  DemoPayloadFingerprinter,
  FixedOffsetScheduleResolver,
  InMemoryDemoUnitOfWork,
} from '../../infrastructure/demo';

const NOW = '2026-08-24T00:00:00.000Z';

class DeterministicIds {
  private value = 0;
  next(): string {
    this.value += 1;
    return `00000000-0000-4000-8000-${this.value.toString().padStart(12, '0')}`;
  }
}

const metadata = (id: number) => ({
  commandId: `command-${id}`,
  idempotencyKey: `key-${id}`,
  issuedAtUtc: NOW,
  payloadSchemaVersion: 1 as const,
});

async function buildPreparedFlow() {
  const unitOfWork = new InMemoryDemoUnitOfWork();
  const app = new DemoApplicationService({
    unitOfWork,
    ids: new DeterministicIds(),
    clock: { now: () => NOW },
    fingerprinter: new DemoPayloadFingerprinter(),
    scheduleResolver: new FixedOffsetScheduleResolver(),
  });

  expect(await app.acknowledgeDemo({ ...metadata(1), disclaimerVersion: 'v0.1' })).toMatchObject({ ok: true });
  const medA = await app.createDemoMedication({
    ...metadata(2),
    displayName: '演示药A',
    dosageForm: 'tablet',
    initialInventoryQuantity: '10',
  });
  const medB = await app.createDemoMedication({
    ...metadata(3),
    displayName: '演示药B',
    dosageForm: 'capsule',
    initialInventoryQuantity: '20',
  });
  if (!medA.ok || !medB.ok) throw new Error('fixture creation failed');
  const regimen = await app.createDailyRegimen({
    ...metadata(4),
    name: '演示早间方案',
    localTime: '08:00',
    timeZone: 'Asia/Shanghai',
    onTimeOffsetMinutes: 30,
    recordOffsetMinutes: 120,
    captureMode: 'group',
    startLocalDate: '2026-08-24',
    items: [
      { medicationId: medA.value.id, plannedDoseQuantity: '1' },
      { medicationId: medB.value.id, plannedDoseQuantity: '2' },
    ],
  });
  expect(regimen.ok).toBe(true);
  const materialized = await app.materializeToday({ ...metadata(5), localDate: '2026-08-24' });
  if (!materialized.ok) throw new Error('materialization failed');
  const occurrence = materialized.value[0]!;
  const prepared = await app.prepareWithPhoto({
    ...metadata(6),
    occurrenceId: occurrence.id,
    privateRelativePath: 'photos/demo-1.jpg',
    capturedAtUtc: NOW,
  });
  if (!prepared.ok) throw new Error('preparation failed');
  return { app, unitOfWork, medA: medA.value, medB: medB.value, occurrence, photo: prepared.value };
}

describe('offline Demo domain flow', () => {
  it('appends a retaken photo without repeating the prepared lifecycle transition', async () => {
    const fixture = await buildPreparedFlow();
    const command = {
      ...metadata(19),
      occurrenceId: fixture.occurrence.id,
      privateRelativePath: 'photos/demo-2.jpg',
      capturedAtUtc: '2026-08-24T00:01:00.000Z',
    };

    const first = await fixture.app.replacePreparedPhoto(command);
    const retry = await fixture.app.replacePreparedPhoto(command);

    expect(first).toMatchObject({
      ok: true,
      value: { privateRelativePath: 'photos/demo-2.jpg' },
    });
    expect(retry).toEqual(first);
    const history = await fixture.app.getHistory(fixture.occurrence.id);
    if (!history.ok) throw new Error('history missing');
    expect(history.value.photos.map((photo) => photo.privateRelativePath)).toEqual([
      'photos/demo-1.jpg',
      'photos/demo-2.jpg',
    ]);
    expect(fixture.unitOfWork.snapshot().occurrences[0]?.currentLifecycle).toBe('prepared');
  });

  it('keeps object count separate and prepared does not deduct inventory', async () => {
    const fixture = await buildPreparedFlow();
    expect((await fixture.app.getInventoryBalance(fixture.medA.id))).toEqual({ ok: true, value: '10' });
    const count = await fixture.app.recordCountObservation({
      ...metadata(7),
      occurrenceId: fixture.occurrence.id,
      photoEvidenceId: fixture.photo.id,
      status: 'counted',
      detectedObjectCount: 8,
      unableReasonCode: null,
      source: 'contour_counter',
      algorithmVersion: 'contour-demo-v1',
    });
    expect(count.ok).toBe(true);
    expect((await fixture.app.getInventoryBalance(fixture.medA.id))).toEqual({ ok: true, value: '10' });
  });

  it('deducts only per-item confirmed quantities and is idempotent', async () => {
    const fixture = await buildPreparedFlow();
    const command = {
      ...metadata(8),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T00:10:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[0]!.id,
          assertion: 'taken_as_planned' as const,
          confirmedConsumptionQuantity: '1',
        },
        {
          occurrenceItemId: fixture.occurrence.items[1]!.id,
          assertion: 'partially_taken' as const,
          confirmedConsumptionQuantity: '1',
        },
      ],
    };
    const first = await fixture.app.confirmOccurrenceItems(command);
    const retry = await fixture.app.confirmOccurrenceItems(command);
    expect(first.ok).toBe(true);
    expect(retry).toEqual(first);
    expect((await fixture.app.getInventoryBalance(fixture.medA.id))).toEqual({ ok: true, value: '9' });
    expect((await fixture.app.getInventoryBalance(fixture.medB.id))).toEqual({ ok: true, value: '19' });
    expect(fixture.unitOfWork.snapshot().inventoryLedger).toHaveLength(4);
  });

  it('uses reversal entries for revoke and revision without erasing facts', async () => {
    const fixture = await buildPreparedFlow();
    const confirmed = await fixture.app.confirmOccurrenceItems({
      ...metadata(9),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T00:10:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[0]!.id,
          assertion: 'taken_as_planned',
          confirmedConsumptionQuantity: '1',
        },
        {
          occurrenceItemId: fixture.occurrence.items[1]!.id,
          assertion: 'partially_taken',
          confirmedConsumptionQuantity: '1',
        },
      ],
    });
    expect(confirmed.ok).toBe(true);
    const history = await fixture.app.getHistory(fixture.occurrence.id);
    if (!history.ok) throw new Error('history missing');
    const factA = history.value.assertionFacts.find((x) => x.occurrenceItemId === fixture.occurrence.items[0]!.id)!;
    const factB = history.value.assertionFacts.find((x) => x.occurrenceItemId === fixture.occurrence.items[1]!.id)!;
    expect((await fixture.app.revokeItemConfirmation({ ...metadata(10), factId: factA.id, reasonCode: 'demo_fix' })).ok).toBe(true);
    expect((await fixture.app.reviseItemConfirmation({
      ...metadata(11),
      factId: factB.id,
      assertion: 'partially_taken',
      confirmedConsumptionQuantity: '0.5',
      confirmedAtUtc: '2026-08-24T00:12:00.000Z',
      reasonCode: 'demo_fix',
    })).ok).toBe(true);
    expect((await fixture.app.getInventoryBalance(fixture.medA.id))).toEqual({ ok: true, value: '10' });
    expect((await fixture.app.getInventoryBalance(fixture.medB.id))).toEqual({ ok: true, value: '19.5' });
    const finalHistory = await fixture.app.getHistory(fixture.occurrence.id);
    if (!finalHistory.ok) throw new Error('history missing');
    expect(finalHistory.value.assertionFacts).toHaveLength(3);
    expect(finalHistory.value.inventoryEntries).toHaveLength(7);
  });

  it('rejects real-looking names without the Demo prefix', async () => {
    const fixture = await buildPreparedFlow();
    const result = await fixture.app.createDemoMedication({
      ...metadata(12),
      displayName: '真实药品名称',
      dosageForm: 'tablet',
      initialInventoryQuantity: '10',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('retains missed facts when a user later backfills consumption', async () => {
    const fixture = await buildPreparedFlow();
    const missed = await fixture.app.markOccurrenceMissed({
      ...metadata(13),
      occurrenceId: fixture.occurrence.id,
      effectiveAtUtc: '2026-08-24T02:00:00.000Z',
    });
    expect(missed).toMatchObject({ ok: true, value: { currentLifecycle: 'missed' } });
    const backfilled = await fixture.app.confirmOccurrenceItems({
      ...metadata(14),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T03:00:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[0]!.id,
          assertion: 'taken_as_planned',
          confirmedConsumptionQuantity: '1',
        },
        {
          occurrenceItemId: fixture.occurrence.items[1]!.id,
          assertion: 'not_taken',
          confirmedConsumptionQuantity: '0',
        },
      ],
    });
    expect(backfilled).toMatchObject({ ok: true, value: { currentLifecycle: 'late_taken' } });
    expect(fixture.unitOfWork.snapshot().missedItemIds).toHaveLength(2);
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const fixture = await buildPreparedFlow();
    const shared = { ...metadata(15), idempotencyKey: 'shared-conflict-key' };
    const first = await fixture.app.createDemoMedication({
      ...shared,
      displayName: '演示药C',
      dosageForm: 'tablet',
      initialInventoryQuantity: '5',
    });
    expect(first.ok).toBe(true);
    const conflict = await fixture.app.createDemoMedication({
      ...shared,
      displayName: '演示药D',
      dosageForm: 'tablet',
      initialInventoryQuantity: '5',
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('atomically revokes a whole occurrence, restores inventory and preserves history', async () => {
    const fixture = await buildPreparedFlow();
    const confirmed = await fixture.app.confirmOccurrenceItems({
      ...metadata(16),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T00:10:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[0]!.id,
          assertion: 'taken_as_planned',
          confirmedConsumptionQuantity: '1',
        },
        {
          occurrenceItemId: fixture.occurrence.items[1]!.id,
          assertion: 'partially_taken',
          confirmedConsumptionQuantity: '1',
        },
      ],
    });
    expect(confirmed.ok).toBe(true);
    expect((await fixture.app.getInventoryBalance(fixture.medA.id))).toEqual({ ok: true, value: '9' });
    expect((await fixture.app.getInventoryBalance(fixture.medB.id))).toEqual({ ok: true, value: '19' });

    const revokeCommand = {
      ...metadata(17),
      occurrenceId: fixture.occurrence.id,
      reasonCode: 'demo_occurrence_correction',
    };
    const revoked = await fixture.app.revokeOccurrence(revokeCommand);
    expect(revoked).toMatchObject({
      ok: true,
      value: {
        currentLifecycle: 'revoked',
        items: [
          { assertion: 'pending', confirmedConsumptionQuantity: null, activeFactId: null },
          { assertion: 'pending', confirmedConsumptionQuantity: null, activeFactId: null },
        ],
      },
    });
    expect((await fixture.app.getInventoryBalance(fixture.medA.id))).toEqual({ ok: true, value: '10' });
    expect((await fixture.app.getInventoryBalance(fixture.medB.id))).toEqual({ ok: true, value: '20' });

    const history = await fixture.app.getHistory(fixture.occurrence.id);
    if (!history.ok) throw new Error('history missing');
    expect(history.value.assertionFacts).toHaveLength(2);
    expect(history.value.inventoryEntries).toHaveLength(6);

    const retry = await fixture.app.revokeOccurrence(revokeCommand);
    expect(retry).toEqual(revoked);
    const retriedHistory = await fixture.app.getHistory(fixture.occurrence.id);
    if (!retriedHistory.ok) throw new Error('history missing');
    expect(retriedHistory.value.assertionFacts).toHaveLength(2);
    expect(retriedHistory.value.inventoryEntries).toHaveLength(6);
  });

  it('can revoke an existing occurrence with no active confirmations', async () => {
    const fixture = await buildPreparedFlow();
    const revoked = await fixture.app.revokeOccurrence({
      ...metadata(18),
      occurrenceId: fixture.occurrence.id,
      reasonCode: 'demo_task_cancelled',
    });
    expect(revoked).toMatchObject({ ok: true, value: { currentLifecycle: 'revoked' } });
    expect(fixture.unitOfWork.snapshot().inventoryLedger).toHaveLength(2);
  });
});

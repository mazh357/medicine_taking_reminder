import { describe, expect, it } from 'vitest';

import { DemoApplicationService } from '../../src/application/DemoApplicationService';
import {
  DemoPayloadFingerprinter,
  FixedOffsetScheduleResolver,
  InMemoryDemoUnitOfWork,
} from '../../src/infrastructure/demo';

const BASE_TIME = '2026-08-24T00:00:00.000Z';

class DeterministicIds {
  private value = 0;

  next(): string {
    this.value += 1;
    return `qa-${this.value.toString().padStart(6, '0')}`;
  }
}

function command(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    commandId: `qa-command-${sequence}`,
    idempotencyKey: `qa-key-${sequence}`,
    issuedAtUtc: BASE_TIME,
    payloadSchemaVersion: 1 as const,
    ...overrides,
  };
}

async function buildPreparedFixture() {
  const unitOfWork = new InMemoryDemoUnitOfWork();
  const application = new DemoApplicationService({
    unitOfWork,
    ids: new DeterministicIds(),
    clock: { now: () => BASE_TIME },
    fingerprinter: new DemoPayloadFingerprinter(),
    scheduleResolver: new FixedOffsetScheduleResolver(),
  });

  expect(
    await application.acknowledgeDemo({
      ...command(1),
      disclaimerVersion: 'demo-boundary-v0.1',
    }),
  ).toMatchObject({ ok: true });

  const medicationA = await application.createDemoMedication({
    ...command(2),
    displayName: '演示药A',
    dosageForm: 'tablet',
    initialInventoryQuantity: '10',
  });
  const medicationB = await application.createDemoMedication({
    ...command(3),
    displayName: '演示药B',
    dosageForm: 'capsule',
    initialInventoryQuantity: '20',
  });
  if (!medicationA.ok || !medicationB.ok) throw new Error('QA fixture medication failed');

  const regimen = await application.createDailyRegimen({
    ...command(4),
    name: '虚构演示方案',
    localTime: '08:00',
    timeZone: 'Asia/Shanghai',
    onTimeOffsetMinutes: 30,
    recordOffsetMinutes: 120,
    captureMode: 'group',
    startLocalDate: '2026-08-24',
    items: [
      { medicationId: medicationA.value.id, plannedDoseQuantity: '1' },
      { medicationId: medicationB.value.id, plannedDoseQuantity: '2' },
    ],
  });
  if (!regimen.ok) throw new Error('QA fixture regimen failed');

  const materialized = await application.materializeToday({
    ...command(5),
    localDate: '2026-08-24',
  });
  if (!materialized.ok || materialized.value.length !== 1) {
    throw new Error('QA fixture materialization failed');
  }
  const occurrence = materialized.value[0]!;
  const photo = await application.prepareWithPhoto({
    ...command(6),
    occurrenceId: occurrence.id,
    privateRelativePath: 'photos/qa-demo.jpg',
    capturedAtUtc: BASE_TIME,
  });
  if (!photo.ok) throw new Error('QA fixture preparation failed');

  return {
    application,
    unitOfWork,
    medicationA: medicationA.value,
    medicationB: medicationB.value,
    occurrence,
    photo: photo.value,
  };
}

describe('QA: Demo domain and inventory contracts', () => {
  it('keeps detected, planned and confirmed quantities independent', async () => {
    const fixture = await buildPreparedFixture();

    expect(
      await fixture.application.recordCountObservation({
        ...command(7),
        occurrenceId: fixture.occurrence.id,
        photoEvidenceId: fixture.photo.id,
        status: 'counted',
        detectedObjectCount: 8,
        unableReasonCode: null,
        source: 'contour_counter',
        algorithmVersion: 'contour-demo-v0.1',
      }),
    ).toMatchObject({ ok: true });

    expect(
      await fixture.application.confirmOccurrenceItems({
        ...command(8),
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
            confirmedConsumptionQuantity: '1.5',
          },
        ],
      }),
    ).toMatchObject({ ok: true });

    const history = await fixture.application.getHistory(fixture.occurrence.id);
    if (!history.ok) throw new Error('QA history missing');
    expect(history.value.countObservations.at(-1)?.detectedObjectCount).toBe(8);
    expect(history.value.occurrence.items.map((item) => item.plannedDoseQuantity)).toEqual(['1', '2']);
    expect(history.value.occurrence.items.map((item) => item.confirmedConsumptionQuantity)).toEqual([
      '1',
      '1.5',
    ]);
    expect(await fixture.application.getInventoryBalance(fixture.medicationA.id)).toEqual({
      ok: true,
      value: '9',
    });
    expect(await fixture.application.getInventoryBalance(fixture.medicationB.id)).toEqual({
      ok: true,
      value: '18.5',
    });
  });

  it('does not deduct inventory when an occurrence is only prepared', async () => {
    const fixture = await buildPreparedFixture();
    const state = fixture.unitOfWork.snapshot();

    expect(state.occurrences[0]?.currentLifecycle).toBe('prepared');
    expect(state.assertionFacts).toHaveLength(0);
    expect(state.inventoryLedger).toHaveLength(2);
    expect(await fixture.application.getInventoryBalance(fixture.medicationA.id)).toEqual({
      ok: true,
      value: '10',
    });
    expect(await fixture.application.getInventoryBalance(fixture.medicationB.id)).toEqual({
      ok: true,
      value: '20',
    });
  });

  it('supports per-item partial consumption without confirming the other item', async () => {
    const fixture = await buildPreparedFixture();
    const result = await fixture.application.confirmOccurrenceItems({
      ...command(9),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T00:10:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[1]!.id,
          assertion: 'partially_taken',
          confirmedConsumptionQuantity: '0.5',
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        currentLifecycle: 'prepared',
        items: [
          { assertion: 'pending', confirmedConsumptionQuantity: null },
          { assertion: 'partially_taken', confirmedConsumptionQuantity: '0.5' },
        ],
      },
    });
    expect(await fixture.application.getInventoryBalance(fixture.medicationA.id)).toEqual({
      ok: true,
      value: '10',
    });
    expect(await fixture.application.getInventoryBalance(fixture.medicationB.id)).toEqual({
      ok: true,
      value: '19.5',
    });
  });

  it('returns the original result on an identical idempotent retry without a second deduction', async () => {
    const fixture = await buildPreparedFixture();
    const confirmation = {
      ...command(10),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T00:10:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[0]!.id,
          assertion: 'taken_as_planned' as const,
          confirmedConsumptionQuantity: '1',
        },
      ],
    };

    const first = await fixture.application.confirmOccurrenceItems(confirmation);
    const retry = await fixture.application.confirmOccurrenceItems(confirmation);
    expect(retry).toEqual(first);

    const state = fixture.unitOfWork.snapshot();
    expect(
      state.inventoryLedger.filter(
        (entry) => entry.medicationId === fixture.medicationA.id && entry.entryType === 'consumption',
      ),
    ).toHaveLength(1);
    expect(await fixture.application.getInventoryBalance(fixture.medicationA.id)).toEqual({
      ok: true,
      value: '9',
    });
  });

  it('revises through a reversal plus a new consumption entry and retains both facts', async () => {
    const fixture = await buildPreparedFixture();
    const confirmed = await fixture.application.confirmOccurrenceItems({
      ...command(11),
      occurrenceId: fixture.occurrence.id,
      confirmedAtUtc: '2026-08-24T00:10:00.000Z',
      items: [
        {
          occurrenceItemId: fixture.occurrence.items[1]!.id,
          assertion: 'partially_taken',
          confirmedConsumptionQuantity: '1',
        },
      ],
    });
    if (!confirmed.ok) throw new Error('QA initial confirmation failed');
    const before = await fixture.application.getHistory(fixture.occurrence.id);
    if (!before.ok) throw new Error('QA history missing');
    const oldFact = before.value.assertionFacts[0]!;

    expect(
      await fixture.application.reviseItemConfirmation({
        ...command(12),
        factId: oldFact.id,
        assertion: 'partially_taken',
        confirmedConsumptionQuantity: '0.5',
        confirmedAtUtc: '2026-08-24T00:15:00.000Z',
        reasonCode: 'qa_correction',
      }),
    ).toMatchObject({ ok: true });

    const after = await fixture.application.getHistory(fixture.occurrence.id);
    if (!after.ok) throw new Error('QA history missing');
    const medicationEntries = after.value.inventoryEntries.filter(
      (entry) => entry.medicationId === fixture.medicationB.id,
    );
    expect(after.value.assertionFacts).toHaveLength(2);
    expect(medicationEntries.map((entry) => [entry.entryType, entry.quantityDelta])).toEqual([
      ['initial', '20'],
      ['consumption', '-1'],
      ['reversal', '1'],
      ['consumption', '-0.5'],
    ]);
    expect(medicationEntries[2]?.reversesEntryId).toBe(medicationEntries[1]?.id);
    expect(after.value.assertionFacts[1]?.supersedesFactId).toBe(oldFact.id);
    expect(await fixture.application.getInventoryBalance(fixture.medicationB.id)).toEqual({
      ok: true,
      value: '19.5',
    });
  });

  it('keeps the manual main path available after contour counting is unable', async () => {
    const fixture = await buildPreparedFixture();

    expect(
      await fixture.application.recordCountObservation({
        ...command(13),
        occurrenceId: fixture.occurrence.id,
        photoEvidenceId: fixture.photo.id,
        status: 'unable',
        detectedObjectCount: null,
        unableReasonCode: 'low_contrast',
        source: 'contour_counter',
        algorithmVersion: 'contour-demo-v0.1',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await fixture.application.recordCountObservation({
        ...command(14),
        occurrenceId: fixture.occurrence.id,
        photoEvidenceId: fixture.photo.id,
        status: 'counted',
        detectedObjectCount: 3,
        unableReasonCode: null,
        source: 'manual_override',
        algorithmVersion: 'manual-v1',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await fixture.application.confirmOccurrenceItems({
        ...command(15),
        occurrenceId: fixture.occurrence.id,
        confirmedAtUtc: '2026-08-24T00:20:00.000Z',
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
      }),
    ).toMatchObject({ ok: true, value: { currentLifecycle: 'taken_confirmed' } });

    const history = await fixture.application.getHistory(fixture.occurrence.id);
    if (!history.ok) throw new Error('QA history missing');
    expect(history.value.countObservations.map((observation) => observation.status)).toEqual([
      'unable',
      'counted',
    ]);
    expect(history.value.occurrence.items[0]?.confirmedConsumptionQuantity).toBe('1');
    expect(history.value.occurrence.items[1]?.confirmedConsumptionQuantity).toBe('0');
  });

  it('rejects names that are not bounded fictitious Demo names', async () => {
    const fixture = await buildPreparedFixture();
    for (const [index, displayName] of [
      '真实药品名称',
      '阿司匹林',
      '演示https://example.test',
      '演示123456',
    ].entries()) {
      const result = await fixture.application.createDemoMedication({
        ...command(20 + index),
        displayName,
        dosageForm: 'tablet',
        initialInventoryQuantity: '5',
      });
      expect(result, displayName).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
  });

  it('clears profile, domain facts, photos, count observations and inventory data', async () => {
    const fixture = await buildPreparedFixture();
    await fixture.application.recordCountObservation({
      ...command(30),
      occurrenceId: fixture.occurrence.id,
      photoEvidenceId: fixture.photo.id,
      status: 'unable',
      detectedObjectCount: null,
      unableReasonCode: 'processing_error',
      source: 'contour_counter',
      algorithmVersion: 'contour-demo-v0.1',
    });

    expect(
      await fixture.application.clearAllDemoData({
        ...command(31),
        confirmed: true,
      }),
    ).toEqual({ ok: true, value: { cleared: true } });

    expect(fixture.unitOfWork.snapshot()).toMatchObject({
      profile: null,
      medications: [],
      regimens: [],
      occurrences: [],
      photos: [],
      countObservations: [],
      assertionFacts: [],
      revocations: [],
      missedItemIds: [],
      inventoryLedger: [],
      processedCommands: [],
    });
  });
});

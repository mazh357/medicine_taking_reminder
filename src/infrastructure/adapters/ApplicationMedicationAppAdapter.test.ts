import { describe, expect, it, vi } from 'vitest';

import type {
  MedicationApplicationService,
  MedicationUnitOfWork,
} from '../../application';
import type { PersonalPhotoEvidence } from '../../domain';
import type { PrivateMediaStore } from '../media';
import type { LocalReminderService } from '../notifications';
import { ApplicationMedicationAppAdapter } from './ApplicationMedicationAppAdapter';
import type { DemoPillCounterAdapter } from './DemoPillCounterAdapter';

const NOW = '2026-08-25T00:00:00.000Z';

function pendingPhoto(): PersonalPhotoEvidence {
  return {
    id: 'photo-1',
    occurrenceId: 'occurrence-1',
    state: 'captured',
    deletionStatus: 'pending',
    captureMode: 'group',
    capturePurpose: 'initial',
    encryptedMediaId: 'encrypted-media/photos/opaque123.med1',
    skipReasonCode: null,
    capturedAtUtc: NOW,
    deletionRequestedAtUtc: NOW,
    deletedAtUtc: null,
    deletionReasonCode: 'user_requested',
    linkedOccurrenceItemIds: ['item-1'],
    createdAtUtc: NOW,
  };
}

function adapterFixture(input: {
  requestResult?: PersonalPhotoEvidence;
  mediaDelete?: () => Promise<void>;
  finalizeResult?:
    | { ok: true; value: PersonalPhotoEvidence }
    | { ok: false; error: { code: string; messageKey: string; retryable: boolean } };
} = {}) {
  const order: string[] = [];
  const pending = input.requestResult ?? pendingPhoto();
  const tombstone: PersonalPhotoEvidence = {
    ...pending,
    state: 'deleted_tombstone',
    deletionStatus: 'deleted',
    encryptedMediaId: null,
    deletedAtUtc: NOW,
  };
  const requestPhotoDeletion = vi.fn(async () => {
    order.push('request');
    return { ok: true as const, value: pending };
  });
  const finalizePhotoTombstone = vi.fn(async () => {
    order.push('tombstone');
    return input.finalizeResult ?? { ok: true as const, value: tombstone };
  });
  const deletePhoto = vi.fn(async () => {
    order.push('media');
    await (input.mediaDelete?.() ?? Promise.resolve());
  });
  const repository = {
    listMedications: vi.fn().mockResolvedValue([]),
    listAllOccurrences: vi.fn().mockResolvedValue([]),
    listAllInventoryLedger: vi.fn().mockResolvedValue([]),
    listRegimensForDate: vi.fn().mockResolvedValue([]),
    listRegimensForMedication: vi.fn().mockResolvedValue([]),
    listAllFollowUpItems: vi.fn().mockResolvedValue([]),
    listAllAuxiliaryReminderIntents: vi.fn().mockResolvedValue([]),
  };
  const unitOfWork: MedicationUnitOfWork = {
    run: async (operation) => operation(repository as never),
  };
  let sequence = 0;
  const adapter = new ApplicationMedicationAppAdapter({
    application: {
      requestPhotoDeletion,
      finalizePhotoTombstone,
      reconcileAuxiliaryReminders: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    } as unknown as MedicationApplicationService,
    unitOfWork,
    media: { deletePhoto } as unknown as PrivateMediaStore,
    counter: {} as DemoPillCounterAdapter,
    reminders: {
      getCapability: vi.fn().mockResolvedValue({ status: 'ready', canSchedule: true }),
    } as unknown as LocalReminderService,
    nextId: () => `command-${++sequence}`,
    now: () => new Date(NOW),
    getDatabaseSchemaVersion: vi.fn().mockResolvedValue(4),
    clearPersonalData: vi.fn().mockResolvedValue(undefined),
  });
  return { adapter, deletePhoto, finalizePhotoTombstone, order, requestPhotoDeletion };
}

function reconciliationFixture(input: {
  occurrences?: Record<string, unknown>[];
  medications?: Record<string, unknown>[];
  ledger?: Record<string, unknown>[];
  regimens?: Record<string, unknown>[];
  versions?: Record<string, unknown>[];
  histories?: Map<string, unknown>;
  followUps?: Record<string, unknown>[];
  reminderIntents?: Record<string, unknown>[];
  reminderProjections?: Map<string, Record<string, unknown>>;
  auxiliaryIntents?: Record<string, unknown>[];
  auxiliaryProjections?: Map<string, Record<string, unknown>>;
  application?: Record<string, unknown>;
  reminders?: Record<string, unknown>;
  repository?: Record<string, unknown>;
} = {}) {
  const occurrences = input.occurrences ?? [];
  const medications = input.medications ?? [];
  const ledger = input.ledger ?? [];
  const regimens = input.regimens ?? [];
  const versions = input.versions ?? [];
  const histories = input.histories ?? new Map<string, unknown>();
  const followUps = input.followUps ?? [];
  const reminderIntents = input.reminderIntents ?? [];
  const reminderProjections = input.reminderProjections ?? new Map();
  const auxiliaryIntents = input.auxiliaryIntents ?? [];
  const auxiliaryProjections = input.auxiliaryProjections ?? new Map();
  const saveAuxiliaryReminderProjection = vi.fn(async (projection: Record<string, unknown>) => {
    auxiliaryProjections.set(String(projection.reminderIntentId), projection);
  });
  const saveReminderProjection = vi.fn(async (projection: Record<string, unknown>) => {
    reminderProjections.set(String(projection.reminderIntentId), projection);
  });
  const repository = {
    listAllOccurrences: vi.fn(async () => occurrences),
    listMedications: vi.fn(async () => medications),
    listAllInventoryLedger: vi.fn(async () => ledger),
    listRegimensForDate: vi.fn(async () => regimens),
    listRegimensForMedication: vi.fn(async (medicationId: string) =>
      regimens.filter((regimen) => {
        const version = versions.find((candidate) => candidate.id === regimen.currentVersionId);
        return Array.isArray(version?.items) && version.items.some(
          (item: Record<string, unknown>) => item.medicationId === medicationId,
        );
      })),
    getRegimenVersion: vi.fn(async (id: string) =>
      versions.find((version) => version.id === id) ?? null),
    getHistory: vi.fn(async (id: string) => histories.get(id) ?? null),
    listCountObservations: vi.fn(async () => []),
    listAllFollowUpItems: vi.fn(async () => followUps),
    getFollowUpItem: vi.fn(async (id: string) =>
      followUps.find((item) => item.id === id) ?? null),
    listAllReminderIntents: vi.fn(async () => reminderIntents),
    getReminderIntentByOccurrence: vi.fn(async () => null),
    getOccurrence: vi.fn(async (id: string) =>
      occurrences.find((occurrence) => occurrence.id === id) ?? null),
    getReminderProjection: vi.fn(async (id: string) => reminderProjections.get(id) ?? null),
    saveReminderProjection,
    listAllAuxiliaryReminderIntents: vi.fn(async () => auxiliaryIntents),
    getAuxiliaryReminderProjection: vi.fn(async (id: string) =>
      auxiliaryProjections.get(id) ?? null),
    saveAuxiliaryReminderProjection,
    ...input.repository,
  };
  const application = {
    materializeDate: vi.fn(async () => ({ ok: true as const, value: [] })),
    reconcileOccurrenceTimes: vi.fn(async (_command: { localDate: string }) => ({
      ok: true as const,
      value: [],
    })),
    getToday: vi.fn(async () => ({ ok: true as const, value: [] })),
    reconcileAuxiliaryReminders: vi.fn(async () => ({ ok: true as const, value: [] })),
    getInventoryForecast: vi.fn(async (medicationId: string) => ({
      ok: true as const,
      value: {
        medicationId,
        balanceQuantity: '0',
        dailyDoseQuantity: null,
        fullDoses: null,
        nextPlannedLocalDate: null,
        estimatedShortageLocalDate: null,
        timeZone: null,
        leadDays: 7,
        nominalTriggerAtUtc: null,
        effectiveTriggerAtUtc: null,
        unavailableReason: 'no_active_daily_plan',
      },
    })),
    ...input.application,
  };
  const reminderOrder: string[] = [];
  const reminders = {
    getCapability: vi.fn(async () => ({ status: 'ready' as const, canSchedule: true as const })),
    cancelProjection: vi.fn(async (id: string) => {
      reminderOrder.push(`cancel:${id}`);
      return { status: 'cancelled' as const };
    }),
    scheduleAuxiliaryAt: vi.fn(async ({ kind }: { kind: string }) => {
      reminderOrder.push(`schedule:${kind}`);
      return { status: 'scheduled' as const, systemNotificationId: `new-${kind}` };
    }),
    ...input.reminders,
  };
  const unitOfWork: MedicationUnitOfWork = {
    run: async (operation) => operation(repository as never),
  };
  let sequence = 0;
  const adapter = new ApplicationMedicationAppAdapter({
    application: application as unknown as MedicationApplicationService,
    unitOfWork,
    media: {} as PrivateMediaStore,
    counter: {} as DemoPillCounterAdapter,
    reminders: reminders as unknown as LocalReminderService,
    nextId: () => `command-${++sequence}`,
    now: () => new Date(NOW),
    getDatabaseSchemaVersion: vi.fn().mockResolvedValue(4),
    clearPersonalData: vi.fn().mockResolvedValue(undefined),
  });
  return {
    adapter,
    application,
    auxiliaryProjections,
    reminderProjections,
    reminderOrder,
    reminders,
    repository,
    saveAuxiliaryReminderProjection,
    saveReminderProjection,
  };
}

function followUpsFrom(adapter: ApplicationMedicationAppAdapter) {
  return (adapter.getSnapshot() as unknown as {
    followUps: Record<string, unknown>[];
  }).followUps;
}

describe('ApplicationMedicationAppAdapter photo deletion orchestration', () => {
  it('performs request, physical media deletion and tombstone finalization in that order', async () => {
    const fixture = adapterFixture();

    await expect(fixture.adapter.deletePhoto('photo-1')).resolves.toBeUndefined();

    expect(fixture.order).toEqual(['request', 'media', 'tombstone']);
    expect(fixture.deletePhoto).toHaveBeenCalledWith(
      'encrypted-media/photos/opaque123.med1',
    );
  });

  it('keeps the record pending and never asks for a tombstone when physical deletion fails', async () => {
    const fixture = adapterFixture({
      mediaDelete: async () => {
        throw new Error('physical delete failed');
      },
    });

    await expect(fixture.adapter.deletePhoto('photo-1')).rejects.toThrow(
      'physical delete failed',
    );
    expect(fixture.order).toEqual(['request', 'media']);
    expect(fixture.finalizePhotoTombstone).not.toHaveBeenCalled();
  });

  it('does not report success when tombstone persistence fails after media deletion', async () => {
    const fixture = adapterFixture({
      finalizeResult: {
        ok: false,
        error: {
          code: 'TRANSACTION_FAILED',
          messageKey: 'error.transaction_failed',
          retryable: true,
        },
      },
    });

    await expect(fixture.adapter.deletePhoto('photo-1')).rejects.toThrow(
      'TRANSACTION_FAILED:error.transaction_failed',
    );
    expect(fixture.order).toEqual(['request', 'media', 'tombstone']);
  });
});

describe('ApplicationMedicationAppAdapter reminder reconciliation', () => {
  it('rebuilds a separate neutral system reminder for every same-day task', async () => {
    const saveReminderProjection = vi.fn().mockResolvedValue(undefined);
    const repository = {
      getReminderIntentByOccurrence: vi.fn(async (occurrenceId: string) => ({
        id: `intent-${occurrenceId}`,
        occurrenceId,
        scheduledAtUtc:
          occurrenceId === 'occ-morning'
            ? '2026-08-25T08:00:00.000Z'
            : '2026-08-25T21:00:00.000Z',
        status: 'active',
      })),
      listAllReminderIntents: vi.fn(async () => [
        {
          id: 'intent-occ-morning', occurrenceId: 'occ-morning',
          scheduledAtUtc: '2026-08-25T08:00:00.000Z', status: 'active',
        },
        {
          id: 'intent-occ-evening', occurrenceId: 'occ-evening',
          scheduledAtUtc: '2026-08-25T21:00:00.000Z', status: 'active',
        },
      ]),
      getOccurrence: vi.fn(async (occurrenceId: string) => ({
        id: occurrenceId,
        currentLifecycle: 'scheduled',
      })),
      getReminderProjection: vi.fn(async (intentId: string) => ({
        reminderIntentId: intentId,
        systemNotificationId: null,
        status: 'pending_rebuild',
        failureCode: null,
        lastReconciledAtUtc: null,
        rowVersion: 1,
      })),
      saveReminderProjection,
      listMedications: vi.fn().mockResolvedValue([]),
      listAllOccurrences: vi.fn().mockResolvedValue([]),
      listAllInventoryLedger: vi.fn().mockResolvedValue([]),
      listRegimensForDate: vi.fn().mockResolvedValue([]),
      listRegimensForMedication: vi.fn().mockResolvedValue([]),
      listAllFollowUpItems: vi.fn().mockResolvedValue([]),
      listAllAuxiliaryReminderIntents: vi.fn().mockResolvedValue([]),
    };
    const unitOfWork: MedicationUnitOfWork = {
      run: async (operation) => operation(repository as never),
    };
    const application = {
      materializeDate: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      reconcileOccurrenceTimes: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      getToday: vi.fn().mockResolvedValue({
        ok: true,
        value: [
          { id: 'occ-morning', currentLifecycle: 'scheduled' },
          { id: 'occ-evening', currentLifecycle: 'scheduled' },
        ],
      }),
      reconcileAuxiliaryReminders: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    };
    const scheduleAt = vi.fn(async ({ occurrenceId }: { occurrenceId: string }) => ({
      status: 'scheduled' as const,
      systemNotificationId: `system-${occurrenceId}`,
    }));
    let sequence = 0;
    const adapter = new ApplicationMedicationAppAdapter({
      application: application as unknown as MedicationApplicationService,
      unitOfWork,
      media: {} as PrivateMediaStore,
      counter: {} as DemoPillCounterAdapter,
      reminders: {
        getCapability: vi.fn().mockResolvedValue({ status: 'ready', canSchedule: true }),
        scheduleAt,
      } as unknown as LocalReminderService,
      nextId: () => `command-${++sequence}`,
      now: () => new Date(NOW),
      getDatabaseSchemaVersion: vi.fn().mockResolvedValue(4),
      clearPersonalData: vi.fn().mockResolvedValue(undefined),
    });

    await adapter.reconcileToday();

    expect(scheduleAt).toHaveBeenCalledTimes(2);
    expect(scheduleAt).toHaveBeenCalledWith({
      reminderIntentId: 'intent-occ-morning',
      occurrenceId: 'occ-morning',
      date: new Date('2026-08-25T08:00:00.000Z'),
    });
    expect(scheduleAt).toHaveBeenCalledWith({
      reminderIntentId: 'intent-occ-evening',
      occurrenceId: 'occ-evening',
      date: new Date('2026-08-25T21:00:00.000Z'),
    });
    expect(saveReminderProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        reminderIntentId: 'intent-occ-morning',
        systemNotificationId: 'system-occ-morning',
        status: 'scheduled',
      }),
    );
    expect(saveReminderProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        reminderIntentId: 'intent-occ-evening',
        systemNotificationId: 'system-occ-evening',
        status: 'scheduled',
      }),
    );
  });

  it('creates all initial schedules in one application command without collapsing quantities', async () => {
    const createMedicationWithSchedules = vi.fn(async (_command: Record<string, unknown>) => ({
      ok: true as const,
      value: {
        medication: { id: 'medication-1' },
        regimens: [{ id: 'schedule-1' }, { id: 'schedule-2' }, { id: 'schedule-3' }],
      },
    }));
    const fixture = reconciliationFixture({
      application: { createMedicationWithSchedules },
    });

    await expect(fixture.adapter.createPersonalMedication({
      name: '药物 A', initialInventory: 30,
      schedules: [
        { reminderTime: '08:00', plannedDoseQuantity: 1 },
        { reminderTime: '13:00', plannedDoseQuantity: 0.5 },
        { reminderTime: '20:00', plannedDoseQuantity: 2 },
      ],
    })).resolves.toBe('medication-1');

    expect(createMedicationWithSchedules).toHaveBeenCalledOnce();
    expect(createMedicationWithSchedules.mock.calls[0]?.[0]).toMatchObject({
      displayName: '药物 A',
      initialInventoryQuantity: '30',
      schedules: [
        { localTime: '08:00', plannedDoseQuantity: '1' },
        { localTime: '13:00', plannedDoseQuantity: '0.5' },
        { localTime: '20:00', plannedDoseQuantity: '2' },
      ],
    });
  });

  it('projects every non-retired schedule sorted by time, including paused schedules', async () => {
    const fixture = reconciliationFixture({
      medications: [{ id: 'med-1', displayName: '药物 A', status: 'active' }],
      regimens: [
        { id: 'reg-evening', status: 'active', currentVersionId: 'version-evening' },
        {
          id: 'reg-morning', status: 'paused', currentVersionId: 'version-morning',
          statusEffectiveLocalDate: '2026-08-25',
        },
        {
          id: 'reg-retired', status: 'active', currentVersionId: 'version-retired',
          retirementEffectiveLocalDate: '2026-08-24',
        },
        {
          id: 'reg-future-retirement', status: 'active',
          currentVersionId: 'version-future-retirement',
          retirementEffectiveLocalDate: '2026-08-26',
        },
      ],
      versions: [
        {
          id: 'version-evening', localTime: '20:00', onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          items: [{ medicationId: 'med-1', plannedDoseQuantity: '2' }],
        },
        {
          id: 'version-morning', localTime: '08:00', onTimeOffsetMinutes: 45,
          recordOffsetMinutes: 600,
          items: [{ medicationId: 'med-1', plannedDoseQuantity: '1' }],
        },
        {
          id: 'version-retired', localTime: '06:00', onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          items: [{ medicationId: 'med-1', plannedDoseQuantity: '3' }],
        },
        {
          id: 'version-future-retirement', localTime: '13:00', onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          items: [{ medicationId: 'med-1', plannedDoseQuantity: '0.5' }],
        },
      ],
    });

    await fixture.adapter.reconcileToday();

    expect((fixture.adapter.getSnapshot().medications[0] as unknown as {
      schedules: Record<string, unknown>[];
    }).schedules).toEqual([
      {
        id: 'reg-morning', reminderTime: '08:00', plannedDoseQuantity: 1,
        status: 'paused', onTimeOffsetMinutes: 45, recordOffsetMinutes: 600,
      },
      {
        id: 'reg-future-retirement', reminderTime: '13:00', plannedDoseQuantity: 0.5,
        status: 'active', onTimeOffsetMinutes: 60, recordOffsetMinutes: 720,
      },
      {
        id: 'reg-evening', reminderTime: '20:00', plannedDoseQuantity: 2,
        status: 'active', onTimeOffsetMinutes: 60, recordOffsetMinutes: 720,
      },
    ]);
  });

  it('keeps tomorrow-effective medication and schedule activation changes out of today view', async () => {
    const fixture = reconciliationFixture({
      medications: [{
        id: 'med-1', displayName: '药物 A', status: 'inactive',
        statusEffectiveLocalDate: '2026-08-26',
      }],
      regimens: [{
        id: 'reg-1', status: 'paused', statusEffectiveLocalDate: '2026-08-26',
        currentVersionId: 'version-1',
      }],
      versions: [{
        id: 'version-1', localTime: '08:00', onTimeOffsetMinutes: 60,
        recordOffsetMinutes: 720,
        items: [{ medicationId: 'med-1', plannedDoseQuantity: '1' }],
      }],
    });

    await fixture.adapter.reconcileToday();

    expect(fixture.adapter.getSnapshot().medications[0]).toMatchObject({
      planState: 'active',
      schedules: [{ id: 'reg-1', status: 'active' }],
    });
  });

  it('does not treat individually paused schedules as a medication-level pause', async () => {
    const fixture = reconciliationFixture({
      medications: [{ id: 'med-1', displayName: '药物 A', status: 'active' }],
      regimens: [
        { id: 'reg-1', status: 'paused', currentVersionId: 'version-1' },
        { id: 'reg-2', status: 'paused', currentVersionId: 'version-2' },
      ],
      versions: [
        {
          id: 'version-1', localTime: '08:00', onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          items: [{ medicationId: 'med-1', plannedDoseQuantity: '1' }],
        },
        {
          id: 'version-2', localTime: '20:00', onTimeOffsetMinutes: 60,
          recordOffsetMinutes: 720,
          items: [{ medicationId: 'med-1', plannedDoseQuantity: '1' }],
        },
      ],
    });

    await fixture.adapter.reconcileToday();

    expect(fixture.adapter.getSnapshot().medications[0]).toMatchObject({
      planState: 'active',
      schedules: [
        { id: 'reg-1', status: 'paused' },
        { id: 'reg-2', status: 'paused' },
      ],
    });
  });

  it('maps medication-level activation results without changing schedule identities', async () => {
    const pauseMedication = vi.fn(async () => ({
      ok: true as const,
      value: {
        medicationId: 'med-1', status: 'inactive',
        effectiveLocalDate: '2026-08-25', effective: 'today',
        affectedRegimenIds: ['reg-1', 'reg-2'],
        replacedOccurrenceIds: ['occ-1', 'occ-2'],
        newOccurrenceIds: [],
        notificationRebuildRequired: true,
      },
    }));
    const fixture = reconciliationFixture({
      application: { pauseMedication },
      repository: {
        getMedication: vi.fn(async () => ({
          id: 'med-1', status: 'active', rowVersion: 4,
        })),
      },
    });

    await expect(fixture.adapter.pauseMedication('med-1')).resolves.toEqual({
      effectiveLocalDate: '2026-08-25', effective: 'today',
      affectedScheduleIds: ['reg-1', 'reg-2'],
      replacedOccurrenceIds: ['occ-1', 'occ-2'],
      newOccurrenceIds: [],
      notificationRebuildRequired: true,
    });
    expect(pauseMedication).toHaveBeenCalledWith(expect.objectContaining({
      medicationId: 'med-1', expectedRowVersion: 4,
      currentLocalDate: '2026-08-25', currentAtUtc: NOW,
    }));
  });

  it('reconciles today plus every older open scheduled, due or prepared service date', async () => {
    const fixture = reconciliationFixture({
      occurrences: [
        {
          id: 'old-scheduled', localServiceDate: '2026-08-21',
          currentLifecycle: 'scheduled', items: [],
        },
        {
          id: 'old-due', localServiceDate: '2026-08-22',
          currentLifecycle: 'due', items: [],
        },
        {
          id: 'old-prepared', localServiceDate: '2026-08-23',
          currentLifecycle: 'prepared', items: [],
        },
        {
          id: 'old-complete', localServiceDate: '2026-08-20',
          currentLifecycle: 'taken_confirmed', items: [],
        },
        {
          id: 'future-open', localServiceDate: '2026-08-26',
          currentLifecycle: 'scheduled', items: [],
        },
      ],
    });

    await fixture.adapter.reconcileToday();

    expect(fixture.application.materializeDate).toHaveBeenCalledWith(
      expect.objectContaining({ localDate: '2026-08-25' }),
    );
    expect(fixture.application.reconcileOccurrenceTimes.mock.calls.map(
      ([command]) => command.localDate,
    )).toEqual(['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-25']);
  });

  it('cancels a stale auxiliary system projection before scheduling its changed intent', async () => {
    const projections = new Map<string, Record<string, unknown>>([
      ['aux-1', {
        reminderIntentId: 'aux-1', systemNotificationId: 'old-system-id',
        status: 'pending_rebuild', failureCode: null, lastReconciledAtUtc: null, rowVersion: 4,
      }],
    ]);
    const fixture = reconciliationFixture({
      auxiliaryIntents: [{
        id: 'aux-1', kind: 'follow_up_due', sourceId: 'followup-1',
        triggerAtUtc: '2026-08-30T09:00:00.000Z', timeZone: 'UTC', status: 'active',
      }],
      auxiliaryProjections: projections,
    });

    await fixture.adapter.reconcileToday();

    expect(fixture.reminderOrder).toEqual([
      'cancel:old-system-id',
      'schedule:follow_up_due',
    ]);
    expect(fixture.saveAuxiliaryReminderProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reminderIntentId: 'aux-1',
        systemNotificationId: 'new-follow_up_due',
        status: 'scheduled',
      }),
    );
  });

  it('keeps the old auxiliary projection cancel-pending and does not replace it when cancellation fails', async () => {
    const projections = new Map<string, Record<string, unknown>>([
      ['aux-1', {
        reminderIntentId: 'aux-1', systemNotificationId: 'old-system-id',
        status: 'pending_rebuild', failureCode: null, lastReconciledAtUtc: null, rowVersion: 4,
      }],
    ]);
    const cancelProjection = vi.fn(async () => ({
      status: 'failed' as const,
      failureCode: 'cancellation_error' as const,
    }));
    const scheduleAuxiliaryAt = vi.fn();
    const fixture = reconciliationFixture({
      auxiliaryIntents: [{
        id: 'aux-1', kind: 'follow_up_due', sourceId: 'followup-1',
        triggerAtUtc: '2026-08-30T09:00:00.000Z', timeZone: 'UTC', status: 'active',
      }],
      auxiliaryProjections: projections,
      reminders: { cancelProjection, scheduleAuxiliaryAt },
    });

    await fixture.adapter.reconcileToday();

    expect(cancelProjection).toHaveBeenCalledWith('old-system-id');
    expect(scheduleAuxiliaryAt).not.toHaveBeenCalled();
    expect(fixture.saveAuxiliaryReminderProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reminderIntentId: 'aux-1',
        systemNotificationId: 'old-system-id',
        status: 'cancel_pending',
      }),
    );
  });

  it('still cancels obsolete auxiliary reminders when notification permission is unavailable', async () => {
    const projections = new Map<string, Record<string, unknown>>([
      ['aux-1', {
        reminderIntentId: 'aux-1', systemNotificationId: 'old-system-id',
        status: 'cancel_pending', failureCode: null, lastReconciledAtUtc: null, rowVersion: 4,
      }],
    ]);
    const cancelProjection = vi.fn(async () => ({ status: 'cancelled' as const }));
    const fixture = reconciliationFixture({
      auxiliaryIntents: [{
        id: 'aux-1', kind: 'follow_up_due', sourceId: 'followup-1',
        triggerAtUtc: '2026-08-30T09:00:00.000Z', timeZone: 'UTC', status: 'cancelled',
      }],
      auxiliaryProjections: projections,
      reminders: {
        getCapability: vi.fn(async () => ({
          status: 'degraded' as const,
          canSchedule: false as const,
          reason: 'permission_denied' as const,
        })),
        cancelProjection,
      },
    });

    await fixture.adapter.reconcileToday();

    expect(cancelProjection).toHaveBeenCalledWith('old-system-id');
    expect(fixture.saveAuxiliaryReminderProjection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reminderIntentId: 'aux-1',
        systemNotificationId: null,
        status: 'cancelled',
      }),
    );
  });

  it('keeps an auxiliary old ID as cancel_pending and never rebuilds until cancellation succeeds', async () => {
    const cancelProjection = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', failureCode: 'cancellation_error' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    const scheduleAuxiliaryAt = vi.fn(async () => ({
      status: 'scheduled' as const,
      systemNotificationId: 'new-follow-up-id',
    }));
    const fixture = reconciliationFixture({
      auxiliaryIntents: [{
        id: 'aux-rebuild', kind: 'follow_up_due', sourceId: 'followup-2',
        triggerAtUtc: '2026-08-30T09:00:00.000Z', timeZone: 'UTC', status: 'active',
      }],
      auxiliaryProjections: new Map([[
        'aux-rebuild',
        {
          reminderIntentId: 'aux-rebuild', systemNotificationId: 'old-follow-up-id',
          status: 'pending_rebuild', failureCode: null, rowVersion: 3,
        },
      ]]),
      reminders: { cancelProjection, scheduleAuxiliaryAt },
    });

    await fixture.adapter.reconcileToday();

    expect(scheduleAuxiliaryAt).not.toHaveBeenCalled();
    expect(fixture.auxiliaryProjections.get('aux-rebuild')).toMatchObject({
      systemNotificationId: 'old-follow-up-id',
      status: 'cancel_pending',
      failureCode: 'cancellation_error',
    });

    await fixture.adapter.reconcileToday();

    expect(cancelProjection).toHaveBeenCalledTimes(2);
    expect(scheduleAuxiliaryAt).toHaveBeenCalledOnce();
    expect(fixture.auxiliaryProjections.get('aux-rebuild')).toMatchObject({
      systemNotificationId: 'new-follow-up-id',
      status: 'scheduled',
      failureCode: null,
    });
  });

  it('attempts cancellation with permission denied and preserves failures for retry', async () => {
    const cancelProjection = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', failureCode: 'cancellation_error' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    const fixture = reconciliationFixture({
      auxiliaryIntents: [{
        id: 'aux-completed', kind: 'follow_up_due', sourceId: 'followup-3',
        triggerAtUtc: '2026-08-30T09:00:00.000Z', timeZone: 'UTC', status: 'cancelled',
      }],
      auxiliaryProjections: new Map([[
        'aux-completed',
        {
          reminderIntentId: 'aux-completed', systemNotificationId: 'old-completed-id',
          status: 'cancel_pending', failureCode: null, rowVersion: 2,
        },
      ]]),
      reminders: {
        getCapability: vi.fn(async () => ({
          status: 'degraded' as const,
          canSchedule: false as const,
          reason: 'permission_denied' as const,
          canAskAgain: false,
        })),
        cancelProjection,
      },
    });

    await fixture.adapter.reconcileToday();
    expect(cancelProjection).toHaveBeenCalledWith('old-completed-id');
    expect(fixture.auxiliaryProjections.get('aux-completed')).toMatchObject({
      systemNotificationId: 'old-completed-id',
      status: 'cancel_pending',
      failureCode: 'cancellation_error',
    });

    await fixture.adapter.reconcileToday();
    expect(fixture.auxiliaryProjections.get('aux-completed')).toMatchObject({
      systemNotificationId: null,
      status: 'cancelled',
      failureCode: null,
    });
  });

  it('retries ordinary medication cancellation across days without losing the old ID', async () => {
    const cancelProjection = vi
      .fn()
      .mockResolvedValueOnce({ status: 'failed', failureCode: 'cancellation_error' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    const scheduleAt = vi.fn();
    const fixture = reconciliationFixture({
      occurrences: [{
        id: 'old-complete', localServiceDate: '2026-08-24',
        currentLifecycle: 'taken_confirmed', items: [],
      }],
      reminderIntents: [{
        id: 'intent-old-complete', occurrenceId: 'old-complete',
        scheduledAtUtc: '2026-08-24T08:00:00.000Z', status: 'completed',
      }],
      reminderProjections: new Map([[
        'intent-old-complete',
        {
          reminderIntentId: 'intent-old-complete', systemNotificationId: 'old-medication-id',
          status: 'cancel_pending', failureCode: null, rowVersion: 2,
        },
      ]]),
      reminders: { cancelProjection, scheduleAt },
    });

    await fixture.adapter.reconcileToday();
    expect(scheduleAt).not.toHaveBeenCalled();
    expect(fixture.reminderProjections.get('intent-old-complete')).toMatchObject({
      systemNotificationId: 'old-medication-id',
      status: 'cancel_pending',
      failureCode: 'cancellation_error',
    });

    await fixture.adapter.reconcileToday();
    expect(cancelProjection).toHaveBeenCalledTimes(2);
    expect(fixture.reminderProjections.get('intent-old-complete')).toMatchObject({
      systemNotificationId: null,
      status: 'cancelled',
      failureCode: null,
    });
  });
});

describe('ApplicationMedicationAppAdapter v4 view contracts', () => {
  it.each([
    {
      label: '完整服用',
      assertion: 'taken_as_planned',
      activeFactId: 'fact-1',
      facts: [{ id: 'fact-1', occurrenceItemId: 'item-1', assertion: 'taken_as_planned', confirmedConsumptionQuantity: '1', recordedAtUtc: NOW, assertedConsumedAtUtc: NOW, source: 'initial', supersedesFactId: null }],
      changes: [{ id: 'consume-1', entryType: 'consumption', quantityDelta: '-1', sourceFactType: 'consumption_assertion', sourceFactId: 'fact-1', reversesEntryId: null }],
      expectedBalance: 9,
      expectedLinkedEntries: 1,
    },
    {
      label: '部分服用',
      assertion: 'partially_taken',
      activeFactId: 'fact-1',
      facts: [{ id: 'fact-1', occurrenceItemId: 'item-1', assertion: 'partially_taken', confirmedConsumptionQuantity: '0.5', recordedAtUtc: NOW, assertedConsumedAtUtc: NOW, source: 'initial', supersedesFactId: null }],
      changes: [{ id: 'consume-1', entryType: 'consumption', quantityDelta: '-0.5', sourceFactType: 'consumption_assertion', sourceFactId: 'fact-1', reversesEntryId: null }],
      expectedBalance: 9.5,
      expectedLinkedEntries: 1,
    },
    {
      label: '确认未服用',
      assertion: 'not_taken',
      activeFactId: 'fact-1',
      facts: [{ id: 'fact-1', occurrenceItemId: 'item-1', assertion: 'not_taken', confirmedConsumptionQuantity: '0', recordedAtUtc: NOW, assertedConsumedAtUtc: null, source: 'initial', supersedesFactId: null }],
      changes: [],
      expectedBalance: 10,
      expectedLinkedEntries: 0,
    },
    {
      label: '修订为部分服用',
      assertion: 'partially_taken',
      activeFactId: 'fact-new',
      facts: [
        { id: 'fact-old', occurrenceItemId: 'item-1', assertion: 'taken_as_planned', confirmedConsumptionQuantity: '1', recordedAtUtc: NOW, assertedConsumedAtUtc: NOW, source: 'initial', supersedesFactId: null },
        { id: 'fact-new', occurrenceItemId: 'item-1', assertion: 'partially_taken', confirmedConsumptionQuantity: '0.5', recordedAtUtc: NOW, assertedConsumedAtUtc: NOW, source: 'correction', supersedesFactId: 'fact-old' },
      ],
      changes: [
        { id: 'consume-old', entryType: 'consumption', quantityDelta: '-1', sourceFactType: 'consumption_assertion', sourceFactId: 'fact-old', reversesEntryId: null },
        { id: 'reverse-old', entryType: 'reversal', quantityDelta: '1', sourceFactType: 'inventory_ledger', sourceFactId: 'consume-old', reversesEntryId: 'consume-old' },
        { id: 'consume-new', entryType: 'consumption', quantityDelta: '-0.5', sourceFactType: 'consumption_assertion', sourceFactId: 'fact-new', reversesEntryId: null },
      ],
      expectedBalance: 9.5,
      expectedLinkedEntries: 3,
    },
    {
      label: '撤销服用',
      assertion: 'taken_as_planned',
      activeFactId: 'fact-old',
      facts: [{ id: 'fact-old', occurrenceItemId: 'item-1', assertion: 'taken_as_planned', confirmedConsumptionQuantity: '1', recordedAtUtc: NOW, assertedConsumedAtUtc: NOW, source: 'initial', supersedesFactId: null }],
      changes: [
        { id: 'consume-old', entryType: 'consumption', quantityDelta: '-1', sourceFactType: 'consumption_assertion', sourceFactId: 'fact-old', reversesEntryId: null },
        { id: 'reverse-old', entryType: 'reversal', quantityDelta: '1', sourceFactType: 'inventory_ledger', sourceFactId: 'consume-old', reversesEntryId: 'consume-old' },
      ],
      expectedBalance: 10,
      expectedLinkedEntries: 2,
      lifecycle: 'revoked',
    },
  ])('projects $label inventory changes and current balance', async (scenario) => {
    const occurrence = {
      id: 'occurrence-1', localServiceDate: '2026-08-25', scheduledAtUtc: NOW,
      onTimeUntilAtUtc: NOW, recordUntilAtUtc: NOW,
      currentLifecycle: scenario.lifecycle ?? 'taken_confirmed',
      items: [{
        id: 'item-1', medicationId: 'med-1', medicationDisplayName: '药物 A',
        plannedDoseQuantity: '1', assertion: scenario.assertion,
        confirmedConsumptionQuantity: scenario.assertion === 'not_taken' ? '0' : scenario.expectedBalance === 9 ? '1' : '0.5',
        activeFactId: scenario.activeFactId,
      }],
    };
    const initial = {
      id: 'initial-1', medicationId: 'med-1', entryType: 'initial', quantityDelta: '10',
      quantityUnit: 'count', sourceFactType: 'medication', sourceFactId: 'med-1',
      reversesEntryId: null, reasonCode: 'initial_inventory', effectiveAtUtc: NOW,
      recordedAtUtc: NOW, commandId: 'command-initial',
    };
    const ledger = [initial, ...scenario.changes.map((entry, index) => ({
      medicationId: 'med-1', quantityUnit: 'count', reasonCode: null,
      effectiveAtUtc: NOW, recordedAtUtc: NOW, commandId: `command-${index}`,
      ...entry,
    }))];
    const fixture = reconciliationFixture({
      medications: [{ id: 'med-1', displayName: '药物 A', status: 'active' }],
      occurrences: [occurrence],
      ledger,
      histories: new Map([['occurrence-1', {
        occurrence, photos: [], countObservations: [], assertionFacts: scenario.facts,
        inventoryEntries: ledger.slice(1),
      }]]),
    });

    await fixture.adapter.reconcileToday();

    const snapshot = fixture.adapter.getSnapshot();
    expect(snapshot.medications[0]?.inventoryBalance).toBe(scenario.expectedBalance);
    expect(snapshot.inventoryLedger.filter((entry) => entry.occurrenceId === 'occurrence-1'))
      .toHaveLength(scenario.expectedLinkedEntries);
    expect(snapshot.inventoryLedger.find((entry) => entry.id === 'initial-1')?.occurrenceId)
      .toBeUndefined();
  });

  it('keeps inventory prediction visible when refill reminders are disabled and never reads image counts', async () => {
    const getInventoryForecast = vi.fn(async () => ({
      ok: true as const,
      value: {
        medicationId: 'med-1', balanceQuantity: '10', dailyDoseQuantity: '1', fullDoses: 10,
        nextPlannedLocalDate: '2026-08-25', estimatedShortageLocalDate: '2026-09-04',
        timeZone: 'UTC', leadDays: null, nominalTriggerAtUtc: null,
        effectiveTriggerAtUtc: null, unavailableReason: null,
      },
    }));
    const fixture = reconciliationFixture({
      medications: [{ id: 'med-1', displayName: '药物 A', status: 'active' }],
      regimens: [{ id: 'reg-1', status: 'active', currentVersionId: 'version-1' }],
      versions: [{
        id: 'version-1', localTime: '08:00', onTimeOffsetMinutes: 60,
        recordOffsetMinutes: 720, items: [{ medicationId: 'med-1', plannedDoseQuantity: '1' }],
      }],
      application: { getInventoryForecast },
    });

    await fixture.adapter.reconcileToday();

    expect(fixture.adapter.getSnapshot().medications[0]).toMatchObject({
      refillReminderDays: 0,
      inventoryPrediction: {
        status: 'available',
        estimatedDepletionLocalDate: '2026-09-03',
        nextInsufficientLocalDate: '2026-09-04',
      },
    });
    expect(getInventoryForecast).toHaveBeenCalledWith(
      'med-1', '2026-08-25', NOW,
    );
    expect(fixture.repository.listCountObservations).not.toHaveBeenCalled();
  });

  it('maps created and edited follow-up fields into the scheduled view', async () => {
    const followUps: Record<string, unknown>[] = [];
    const createFollowUpItem = vi.fn(async (command: Record<string, unknown>) => {
      const item = {
        id: 'followup-1', type: command.type, title: command.title, dueAtUtc: command.dueAtUtc,
        timeZone: command.timeZone, medicationId: command.medicationId,
        note: command.note, advanceDays: command.advanceDays, status: 'pending',
        completedAtUtc: null, cancelledAtUtc: null, rowVersion: 1,
      };
      followUps.push(item);
      return { ok: true as const, value: item };
    });
    const editFollowUpItem = vi.fn(async (command: Record<string, unknown>) => {
      const current = followUps[0]!;
      Object.assign(current, command.changes, { rowVersion: 2 });
      return { ok: true as const, value: current };
    });
    const fixture = reconciliationFixture({
      followUps,
      application: { createFollowUpItem, editFollowUpItem },
    });

    const id = await fixture.adapter.createFollowUp({
      type: 'test', title: '复查项目', scheduledAt: '2026-09-01T08:00:00.000Z',
      medicationId: null, notes: '带上报告', advanceReminderDays: 3,
    });
    expect(id).toBe('followup-1');
    expect(followUpsFrom(fixture.adapter)[0]).toMatchObject({
      id: 'followup-1', status: 'scheduled', title: '复查项目', notes: '带上报告',
      advanceReminderDays: 3, completedAt: null, cancelledAt: null,
    });

    await fixture.adapter.updateFollowUp('followup-1', {
      type: 'follow_up', title: '复诊', scheduledAt: '2026-09-02T08:00:00.000Z',
      medicationId: null, notes: '新备注', advanceReminderDays: 0,
    });
    expect(followUpsFrom(fixture.adapter)[0]).toMatchObject({
      status: 'scheduled', type: 'follow_up', title: '复诊', notes: '新备注',
      advanceReminderDays: 0,
    });
  });

  it.each([
    ['completeFollowUp', 'completed', 'completedAtUtc'],
    ['cancelFollowUp', 'cancelled', 'cancelledAtUtc'],
  ] as const)('%s cancels both pending system reminders and maps %s', async (
    operation,
    expectedStatus,
    timestampField,
  ) => {
    const followUps: Record<string, unknown>[] = [{
      id: 'followup-1', type: 'follow_up', title: '复诊', dueAtUtc: '2026-09-01T08:00:00.000Z',
      timeZone: 'UTC', medicationId: null, note: '', advanceDays: 3, status: 'pending',
      completedAtUtc: null, cancelledAtUtc: null, rowVersion: 1,
    }];
    const intents: Record<string, unknown>[] = [
      { id: 'advance-intent', kind: 'follow_up_advance', sourceId: 'followup-1', status: 'active' },
      { id: 'due-intent', kind: 'follow_up_due', sourceId: 'followup-1', status: 'active' },
    ];
    const close = vi.fn(async () => {
      Object.assign(followUps[0]!, {
        status: expectedStatus,
        [timestampField]: NOW,
        rowVersion: 2,
      });
      for (const intent of intents) intent.status = 'cancelled';
      return { ok: true as const, value: followUps[0] };
    });
    const fixture = reconciliationFixture({
      followUps,
      auxiliaryIntents: intents,
      auxiliaryProjections: new Map([
        ['advance-intent', {
          reminderIntentId: 'advance-intent', systemNotificationId: 'old-advance',
          status: 'cancel_pending', rowVersion: 2,
        }],
        ['due-intent', {
          reminderIntentId: 'due-intent', systemNotificationId: 'old-due',
          status: 'cancel_pending', rowVersion: 2,
        }],
      ]),
      application: {
        completeFollowUpItem: expectedStatus === 'completed' ? close : undefined,
        cancelFollowUpItem: expectedStatus === 'cancelled' ? close : undefined,
      },
    });

    if (operation === 'completeFollowUp') await fixture.adapter.completeFollowUp('followup-1');
    else await fixture.adapter.cancelFollowUp('followup-1');

    expect(fixture.reminderOrder).toEqual(['cancel:old-advance', 'cancel:old-due']);
    expect(followUpsFrom(fixture.adapter)[0]).toMatchObject({
      status: expectedStatus,
      completedAt: expectedStatus === 'completed' ? NOW : null,
      cancelledAt: expectedStatus === 'cancelled' ? NOW : null,
    });
  });
});

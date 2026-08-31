import { describe, expect, it, vi } from 'vitest';

import type {
  AppProfile,
  AuxiliaryReminderIntent,
  FollowUpItem,
  FollowUpItemEvent,
  InventoryForecastPreference,
  PersonalConsumptionAssertionFact,
  PersonalCountObservation,
  PersonalDoseOccurrence,
  PersonalInventoryLedgerEntry,
  PersonalMedication,
  PersonalPhotoEvidence,
  PersonalRegimen,
  RegimenVersion,
} from '../../domain';
import { normalizeQuantity } from '../../domain';
import { MedicationApplicationService } from '../MedicationApplicationService';
import type {
  FinalizePhotoTombstoneCommand,
  PersonalWriteCommand,
} from '../personalCommands';
import type { MedicationRepository } from '../personalPorts';

const NOW = '2026-08-25T00:00:00.000Z';
const PROFILE: AppProfile = {
  id: 'local-profile',
  createdAtUtc: NOW,
  updatedAtUtc: NOW,
  rowVersion: 1,
};
const MEDICATION: PersonalMedication = {
  id: 'med-1',
  displayName: '长期用药 A',
  quantityUnit: 'count',
  status: 'active',
  createdAtUtc: NOW,
  updatedAtUtc: NOW,
  rowVersion: 1,
};
const VERSION: RegimenVersion = {
  id: 'version-1',
  regimenId: 'regimen-1',
  versionNumber: 1,
  name: '晨间计划',
  localTime: '08:00',
  timeZone: 'UTC',
  onTimeOffsetMinutes: 30,
  recordOffsetMinutes: 120,
  captureMode: 'group',
  effectiveLocalDate: '2026-08-25',
  effectiveToLocalDate: null,
  supersededAtUtc: null,
  supersedesVersionId: null,
  items: [
    {
      id: 'version-item-1',
      regimenVersionId: 'version-1',
      medicationId: MEDICATION.id,
      plannedDoseQuantity: normalizeQuantity('1'),
      quantityUnit: 'count',
      sortOrder: 0,
    },
  ],
  createdAtUtc: NOW,
};
const REGIMEN: PersonalRegimen = {
  id: 'regimen-1',
  status: 'active',
  statusEffectiveLocalDate: '2026-08-25',
  currentVersionId: VERSION.id,
  rowVersion: 1,
  createdAtUtc: NOW,
  updatedAtUtc: NOW,
};

function occurrence(overrides: Partial<PersonalDoseOccurrence> = {}): PersonalDoseOccurrence {
  return {
    id: 'occurrence-old',
    regimenId: REGIMEN.id,
    regimenVersionId: VERSION.id,
    localServiceDate: '2026-08-25',
    scheduledAtUtc: '2026-08-25T08:00:00.000Z',
    onTimeUntilAtUtc: '2026-08-25T08:30:00.000Z',
    recordUntilAtUtc: '2026-08-25T10:00:00.000Z',
    currentLifecycle: 'scheduled',
    planProjectionState: 'active',
    replacedByOccurrenceId: null,
    rowVersion: 1,
    items: [
      {
        id: 'occurrence-item-1',
        occurrenceId: 'occurrence-old',
        regimenVersionItemId: 'version-item-1',
        medicationId: MEDICATION.id,
        medicationDisplayName: MEDICATION.displayName,
        plannedDoseQuantity: normalizeQuantity('1'),
        quantityUnit: 'count',
        sortOrder: 0,
        assertion: 'pending',
        confirmedConsumptionQuantity: null,
        activeFactId: null,
      },
    ],
    createdAtUtc: NOW,
    ...overrides,
  };
}

function baseRepository(overrides: Partial<MedicationRepository>): MedicationRepository {
  const processed = new Map<string, { payloadFingerprint: string; resultJson: string }>();
  return {
    getProcessedCommand: vi.fn(async (type, key) => {
      const value = processed.get(`${type}:${key}`);
      return value
        ? {
            commandType: type,
            idempotencyKey: key,
            payloadFingerprint: value.payloadFingerprint,
            resultJson: value.resultJson,
            processedAtUtc: NOW,
          }
        : null;
    }),
    saveProcessedCommand: vi.fn(async (command) => {
      processed.set(`${command.commandType}:${command.idempotencyKey}`, command);
    }),
    ...overrides,
  } as MedicationRepository;
}

function createApplication(repository: MedicationRepository) {
  let sequence = 0;
  return new MedicationApplicationService({
    unitOfWork: { run: async (operation) => operation(repository) },
    ids: { next: () => `generated-${++sequence}` },
    clock: { now: () => NOW },
    fingerprinter: { fingerprint: (value) => JSON.stringify(value) },
    scheduleResolver: {
      resolveDailySchedule: ({ localDate, localTime, onTimeOffsetMinutes, recordOffsetMinutes }) => {
        const scheduled = new Date(`${localDate}T${localTime}:00.000Z`);
        return {
          scheduledAtUtc: scheduled.toISOString(),
          onTimeUntilAtUtc: new Date(
            scheduled.valueOf() + onTimeOffsetMinutes * 60_000,
          ).toISOString(),
          recordUntilAtUtc: new Date(
            scheduled.valueOf() + recordOffsetMinutes * 60_000,
          ).toISOString(),
        };
      },
    },
  });
}

function command(sequence: number): PersonalWriteCommand {
  return {
    commandId: `command-${sequence}`,
    idempotencyKey: `key-${sequence}`,
    issuedAtUtc: NOW,
    payloadSchemaVersion: 2,
  };
}

describe('personal application contracts', () => {
  it('accepts a neutral medication name, uses count, permits zero stock and stays idempotent', async () => {
    const inserted: PersonalMedication[] = [];
    const inventoryEntries: unknown[] = [];
    const repository = baseRepository({
      getAppProfile: vi.fn(async () => PROFILE),
      insertMedication: vi.fn(async (medication) => {
        inserted.push(medication);
      }),
      insertInventoryForecastPreference: vi.fn(async () => undefined),
      insertInventoryEntry: vi.fn(async (entry) => {
        inventoryEntries.push(entry);
      }),
    });
    const application = createApplication(repository);
    const create = {
      ...command(1),
      displayName: '  阿司匹林肠溶片 100mg  ',
      initialInventoryQuantity: '0',
    } as const;

    const first = await application.createMedication(create);
    const retry = await application.createMedication(create);

    expect(first).toMatchObject({
      ok: true,
      value: { displayName: '阿司匹林肠溶片 100mg', quantityUnit: 'count' },
    });
    expect(retry).toEqual(first);
    expect(inserted).toHaveLength(1);
    expect(inventoryEntries).toHaveLength(0);
    expect(repository.insertInventoryForecastPreference).toHaveBeenCalledWith({
      medicationId: first.ok ? first.value.id : '',
      leadDays: 7,
      updatedAtUtc: NOW,
      rowVersion: 1,
    });
  });

  it('replaces a future scheduled occurrence today and moves an elapsed change to tomorrow', async () => {
    const oldOccurrence = occurrence();
    const occurrences = new Map([[oldOccurrence.id, oldOccurrence]]);
    const versions = new Map([[VERSION.id, VERSION]]);
    let regimen = { ...REGIMEN };
    const revisions: unknown[] = [];
    const repository = baseRepository({
      getRegimen: vi.fn(async () => regimen),
      getRegimenVersion: vi.fn(async (id) => versions.get(id) ?? null),
      findActiveOccurrence: vi.fn(async (_regimenId, localDate) =>
        [...occurrences.values()].find(
          (item) => item.localServiceDate === localDate && item.planProjectionState === 'active',
        ) ?? null,
      ),
      getMedication: vi.fn(async () => MEDICATION),
      updateMedicationName: vi.fn(async () => undefined),
      appendRegimenVersion: vi.fn(async (nextRegimen, version) => {
        regimen = nextRegimen;
        versions.set(version.id, version);
      }),
      listActiveOccurrencesForRegimenFromDate: vi.fn(async (_id, date) =>
        [...occurrences.values()].filter(
          (item) => item.localServiceDate >= date && item.planProjectionState === 'active',
        ),
      ),
      replaceOccurrence: vi.fn(async (id, replacementId) => {
        const old = occurrences.get(id)!;
        occurrences.set(id, {
          ...old,
          currentLifecycle: 'revoked',
          planProjectionState: 'replaced',
          replacedByOccurrenceId: replacementId,
        });
      }),
      cancelReminderIntent: vi.fn(async () => undefined),
      insertOccurrence: vi.fn(async (value) => {
        occurrences.set(value.id, value);
      }),
      upsertReminderIntent: vi.fn(async () => undefined),
      saveReminderProjection: vi.fn(async () => undefined),
      appendRegimenRevision: vi.fn(async (event) => {
        revisions.push(event);
      }),
    });
    const application = createApplication(repository);

    const today = await application.updateRegimenPlan({
      ...command(2),
      regimenId: REGIMEN.id,
      expectedRowVersion: 1,
      currentLocalDate: '2026-08-25',
      currentAtUtc: '2026-08-25T07:00:00.000Z',
      changes: {
        localTime: '09:00',
        itemChanges: [{ medicationId: MEDICATION.id, plannedDoseQuantity: '0.5' }],
      },
    });
    expect(today).toMatchObject({
      ok: true,
      value: {
        effective: 'today',
        effectiveLocalDate: '2026-08-25',
        replacedOccurrenceId: oldOccurrence.id,
      },
    });
    if (!today.ok) throw new Error('today change failed');
    const replacement = occurrences.get(today.value.newOccurrenceId!);
    expect(replacement?.items[0]?.plannedDoseQuantity).toBe('0.5');
    expect(occurrences.get(oldOccurrence.id)).toMatchObject({
      currentLifecycle: 'revoked',
      planProjectionState: 'replaced',
    });

    const tomorrow = await application.updateRegimenPlan({
      ...command(3),
      regimenId: REGIMEN.id,
      expectedRowVersion: 2,
      currentLocalDate: '2026-08-25',
      currentAtUtc: '2026-08-25T07:00:00.000Z',
      changes: { localTime: '06:00' },
    });
    expect(tomorrow).toMatchObject({
      ok: true,
      value: { effective: 'tomorrow', effectiveLocalDate: '2026-08-26' },
    });
    expect(revisions).toHaveLength(2);
  });

  it('pauses a future task today and resumes today only when its reminder is still future', async () => {
    let regimen = { ...REGIMEN };
    let activeOccurrence: PersonalDoseOccurrence | null = occurrence();
    const replaceOccurrence = vi.fn(async () => {
      activeOccurrence = null;
    });
    const insertOccurrence = vi.fn(async (value: PersonalDoseOccurrence) => {
      activeOccurrence = value;
    });
    const repository = baseRepository({
      getRegimen: vi.fn(async () => regimen),
      getRegimenVersion: vi.fn(async () => VERSION),
      getEffectiveRegimenVersion: vi.fn(async () => VERSION),
      findActiveOccurrence: vi.fn(async () => activeOccurrence),
      listActiveOccurrencesForRegimenFromDate: vi.fn(async () =>
        activeOccurrence ? [activeOccurrence] : [],
      ),
      setRegimenStatus: vi.fn(async (input) => {
        regimen = {
          ...regimen,
          status: input.status,
          statusEffectiveLocalDate: input.effectiveLocalDate,
          rowVersion: regimen.rowVersion + 1,
        };
      }),
      replaceOccurrence,
      cancelReminderIntent: vi.fn(async () => undefined),
      appendRegimenRevision: vi.fn(async () => undefined),
      getMedication: vi.fn(async () => MEDICATION),
      insertOccurrence,
      upsertReminderIntent: vi.fn(async () => undefined),
      saveReminderProjection: vi.fn(async () => undefined),
    });
    const application = createApplication(repository);

    const paused = await application.pauseRegimen({
      ...command(4),
      regimenId: REGIMEN.id,
      expectedRowVersion: 1,
      currentLocalDate: '2026-08-25',
      currentAtUtc: '2026-08-25T07:00:00.000Z',
    });
    expect(paused).toMatchObject({ ok: true, value: { effective: 'today' } });
    expect(replaceOccurrence).toHaveBeenCalledTimes(1);

    const resumed = await application.resumeRegimen({
      ...command(5),
      regimenId: REGIMEN.id,
      expectedRowVersion: 2,
      currentLocalDate: '2026-08-25',
      currentAtUtc: '2026-08-25T07:10:00.000Z',
    });
    expect(resumed).toMatchObject({ ok: true, value: { effective: 'today' } });
    expect(insertOccurrence).toHaveBeenCalledTimes(1);
  });

  it('corrects inventory by an append-only difference and does not duplicate a retry', async () => {
    const ledger = [
      {
        id: 'initial',
        medicationId: MEDICATION.id,
        entryType: 'initial' as const,
        quantityDelta: '10' as never,
        quantityUnit: 'count' as const,
        sourceFactType: 'medication' as const,
        sourceFactId: MEDICATION.id,
        reversesEntryId: null,
        reasonCode: null,
        effectiveAtUtc: NOW,
        recordedAtUtc: NOW,
        commandId: 'seed',
      },
    ];
    const repository = baseRepository({
      getMedication: vi.fn(async () => MEDICATION),
      listInventoryLedger: vi.fn(async () => ledger),
      insertInventoryEntry: vi.fn(async (entry) => {
        ledger.push(entry);
      }),
    });
    const application = createApplication(repository);
    const correction = {
      ...command(6),
      medicationId: MEDICATION.id,
      targetInventoryQuantity: '7.5',
      reasonCode: 'counted_stock',
    } as const;

    const first = await application.correctInventory(correction);
    const retry = await application.correctInventory(correction);
    expect(first).toMatchObject({ ok: true, value: { adjustedBy: '-2.5' } });
    expect(retry).toEqual(first);
    expect(ledger.map((entry) => entry.quantityDelta)).toEqual(['10', '-2.5']);
    expect(ledger[1]).toMatchObject({ entryType: 'manual_adjustment', quantityUnit: 'count' });
  });

  it('reconciles due then missed while retaining item-level missed history', async () => {
    let current = occurrence();
    const lifecycleWrites: string[] = [];
    const missedItemIds: string[] = [];
    const repository = baseRepository({
      listActiveOccurrencesForDate: vi.fn(async () => [current]),
      updateOccurrenceLifecycle: vi.fn(async (_id, lifecycle) => {
        lifecycleWrites.push(lifecycle);
        current = { ...current, currentLifecycle: lifecycle };
      }),
      getOccurrence: vi.fn(async () => current),
      addMissedEvents: vi.fn(async (_id, itemIds) => {
        missedItemIds.push(...itemIds);
      }),
    });
    const result = await createApplication(repository).reconcileOccurrenceTimes({
      ...command(7),
      localDate: '2026-08-25',
      currentAtUtc: '2026-08-25T11:00:00.000Z',
    });

    expect(result).toMatchObject({ ok: true, value: [{ currentLifecycle: 'missed' }] });
    expect(lifecycleWrites).toEqual(['due', 'missed']);
    expect(missedItemIds).toEqual(['occurrence-item-1']);
  });

  it('materializes every same-day task once, sorts them and preserves a cross-midnight record window', async () => {
    const morningVersion: RegimenVersion = {
      ...VERSION,
      id: 'version-morning',
      regimenId: 'regimen-morning',
      localTime: '08:00',
      items: VERSION.items.map((item) => ({
        ...item,
        id: 'version-item-morning',
        regimenVersionId: 'version-morning',
      })),
    };
    const eveningVersion: RegimenVersion = {
      ...VERSION,
      id: 'version-evening',
      regimenId: 'regimen-evening',
      localTime: '23:30',
      onTimeOffsetMinutes: 30,
      recordOffsetMinutes: 120,
      items: VERSION.items.map((item) => ({
        ...item,
        id: 'version-item-evening',
        regimenVersionId: 'version-evening',
      })),
    };
    const regimens: PersonalRegimen[] = [
      {
        ...REGIMEN,
        id: 'regimen-evening',
        currentVersionId: eveningVersion.id,
      },
      {
        ...REGIMEN,
        id: 'regimen-morning',
        currentVersionId: morningVersion.id,
      },
    ];
    const versions = new Map([
      [morningVersion.id, morningVersion],
      [eveningVersion.id, eveningVersion],
    ]);
    const occurrences = new Map<string, PersonalDoseOccurrence>();
    const reminderIntents: unknown[] = [];
    const reminderProjections: unknown[] = [];
    const repository = baseRepository({
      listRegimensForDate: vi.fn(async () => regimens),
      getEffectiveRegimenVersion: vi.fn(async (_regimenId, localDate) =>
        [...versions.values()].find(
          (version) =>
            version.regimenId === _regimenId && version.effectiveLocalDate <= localDate,
        ) ?? null,
      ),
      findActiveOccurrence: vi.fn(async (regimenId, localDate) =>
        [...occurrences.values()].find(
          (item) =>
            item.regimenId === regimenId &&
            item.localServiceDate === localDate &&
            item.planProjectionState === 'active',
        ) ?? null,
      ),
      getMedication: vi.fn(async () => MEDICATION),
      insertOccurrence: vi.fn(async (value) => {
        occurrences.set(value.id, value);
      }),
      upsertReminderIntent: vi.fn(async (intent) => {
        reminderIntents.push(intent);
      }),
      saveReminderProjection: vi.fn(async (projection) => {
        reminderProjections.push(projection);
      }),
    });
    const application = createApplication(repository);

    const first = await application.materializeDate({
      ...command(16),
      localDate: '2026-08-25',
    });
    const second = await application.materializeDate({
      ...command(17),
      localDate: '2026-08-25',
    });

    expect(first.ok && first.value.map((item) => item.scheduledAtUtc)).toEqual([
      '2026-08-25T08:00:00.000Z',
      '2026-08-25T23:30:00.000Z',
    ]);
    expect(second.ok && second.value).toHaveLength(2);
    expect(occurrences).toHaveLength(2);
    expect(reminderIntents).toHaveLength(2);
    expect(reminderProjections).toHaveLength(2);
    expect(reminderProjections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'pending_rebuild' }),
        expect.objectContaining({ status: 'pending_rebuild' }),
      ]),
    );
    const evening = [...occurrences.values()].find(
      (item) => item.regimenId === 'regimen-evening',
    );
    expect(evening).toMatchObject({
      localServiceDate: '2026-08-25',
      scheduledAtUtc: '2026-08-25T23:30:00.000Z',
      recordUntilAtUtc: '2026-08-26T01:30:00.000Z',
    });
  });

  it('uses a two-phase photo deletion and keeps only a tombstone after media verification', async () => {
    let photo: PersonalPhotoEvidence = {
      id: 'photo-1',
      occurrenceId: 'occurrence-old',
      state: 'captured',
      deletionStatus: 'active',
      captureMode: 'group',
      capturePurpose: 'initial',
      encryptedMediaId: 'media-1',
      skipReasonCode: null,
      capturedAtUtc: NOW,
      deletionRequestedAtUtc: null,
      deletedAtUtc: null,
      deletionReasonCode: null,
      linkedOccurrenceItemIds: ['occurrence-item-1'],
      createdAtUtc: NOW,
    };
    const repository = baseRepository({
      getPhotoEvidence: vi.fn(async () => photo),
      markPhotoDeletionPending: vi.fn(async (_id, at, reason) => {
        photo = {
          ...photo,
          deletionStatus: 'pending',
          deletionRequestedAtUtc: at,
          deletionReasonCode: reason,
        };
      }),
      finalizePhotoTombstone: vi.fn(async (_id, at) => {
        photo = {
          ...photo,
          state: 'deleted_tombstone',
          deletionStatus: 'deleted',
          encryptedMediaId: null,
          deletedAtUtc: at,
        };
      }),
    });
    const application = createApplication(repository);
    expect(
      await application.requestPhotoDeletion({
        ...command(8),
        photoEvidenceId: photo.id,
        reasonCode: 'user_requested',
      }),
    ).toMatchObject({ ok: true, value: { state: 'captured', deletionStatus: 'pending' } });
    expect(
      await application.finalizePhotoTombstone({
        ...command(9),
        photoEvidenceId: photo.id,
        mediaDeletionVerified: true,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        state: 'deleted_tombstone',
        deletionStatus: 'deleted',
        encryptedMediaId: null,
      },
    });
  });

  it('never finalizes a photo tombstone without verified media deletion or after a tombstone write failure', async () => {
    let photo: PersonalPhotoEvidence = {
      id: 'photo-pending',
      occurrenceId: 'occurrence-old',
      state: 'captured',
      deletionStatus: 'pending',
      captureMode: 'group',
      capturePurpose: 'initial',
      encryptedMediaId: 'media-still-present',
      skipReasonCode: null,
      capturedAtUtc: NOW,
      deletionRequestedAtUtc: NOW,
      deletedAtUtc: null,
      deletionReasonCode: 'user_requested',
      linkedOccurrenceItemIds: ['occurrence-item-1'],
      createdAtUtc: NOW,
    };
    const finalizePhotoTombstone = vi.fn(async () => {
      throw new Error('database write failed');
    });
    const repository = baseRepository({
      getPhotoEvidence: vi.fn(async () => photo),
      finalizePhotoTombstone,
    });
    const application = createApplication(repository);

    const unverified = await application.finalizePhotoTombstone({
      ...command(18),
      photoEvidenceId: photo.id,
      mediaDeletionVerified: false,
    } as unknown as FinalizePhotoTombstoneCommand);
    expect(unverified).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', messageKey: 'error.media_deletion_not_verified' },
    });
    expect(finalizePhotoTombstone).not.toHaveBeenCalled();

    const failedWrite = await application.finalizePhotoTombstone({
      ...command(19),
      photoEvidenceId: photo.id,
      mediaDeletionVerified: true,
    });
    expect(failedWrite).toMatchObject({
      ok: false,
      error: { code: 'TRANSACTION_FAILED', retryable: true },
    });
    expect(photo).toMatchObject({
      state: 'captured',
      deletionStatus: 'pending',
      encryptedMediaId: 'media-still-present',
      deletedAtUtc: null,
    });
  });

  it('keeps re-taken photos and detected count separate from manual consumption and inventory', async () => {
    let current = occurrence({ currentLifecycle: 'due' });
    const photos: PersonalPhotoEvidence[] = [];
    const observations: PersonalCountObservation[] = [];
    const facts: PersonalConsumptionAssertionFact[] = [];
    const revoked = new Set<string>();
    const ledger: PersonalInventoryLedgerEntry[] = [];
    const repository = baseRepository({
      getOccurrence: vi.fn(async () => current),
      getOccurrenceByItemId: vi.fn(async () => current),
      getRegimenVersion: vi.fn(async () => VERSION),
      updateOccurrenceLifecycle: vi.fn(async (_id, lifecycle) => {
        current = { ...current, currentLifecycle: lifecycle };
      }),
      insertPhotoEvidence: vi.fn(async (photo) => {
        photos.push(photo);
      }),
      listPhotoEvidence: vi.fn(async () => photos),
      getPhotoEvidence: vi.fn(async (id) => photos.find((photo) => photo.id === id) ?? null),
      insertCountObservation: vi.fn(async (observation) => {
        observations.push(observation);
      }),
      insertAssertionFact: vi.fn(async (fact) => {
        facts.push(fact);
      }),
      getAssertionFact: vi.fn(async (id) => facts.find((fact) => fact.id === id) ?? null),
      setItemCurrentFromFact: vi.fn(async (fact) => {
        current = {
          ...current,
          items: current.items.map((item) =>
            item.id === fact.occurrenceItemId
              ? {
                  ...item,
                  assertion: fact.assertion,
                  confirmedConsumptionQuantity: fact.confirmedConsumptionQuantity,
                  activeFactId: fact.id,
                }
              : item,
          ),
        };
      }),
      insertFactRevocation: vi.fn(async (revocation) => {
        revoked.add(revocation.factId);
      }),
      isAssertionFactRevoked: vi.fn(async (factId) => revoked.has(factId)),
      insertInventoryEntry: vi.fn(async (entry) => {
        ledger.push(entry);
      }),
      findConsumptionEntry: vi.fn(async (factId) =>
        ledger.find(
          (entry) =>
            entry.entryType === 'consumption' &&
            entry.sourceFactType === 'consumption_assertion' &&
            entry.sourceFactId === factId,
        ) ?? null,
      ),
      findReversalEntry: vi.fn(async (entryId) =>
        ledger.find((entry) => entry.reversesEntryId === entryId) ?? null,
      ),
      hasMissedEvent: vi.fn(async () => false),
      resolveMissedEvent: vi.fn(async () => undefined),
    });
    const application = createApplication(repository);

    const firstPhoto = await application.prepareWithPhoto({
      ...command(10),
      occurrenceId: current.id,
      currentLocalDate: current.localServiceDate,
      encryptedMediaId: 'media-1',
      capturedAtUtc: '2026-08-25T08:01:00.000Z',
    });
    const secondPhoto = await application.prepareWithPhoto({
      ...command(11),
      occurrenceId: current.id,
      currentLocalDate: current.localServiceDate,
      encryptedMediaId: 'media-2',
      capturedAtUtc: '2026-08-25T08:02:00.000Z',
    });
    expect(firstPhoto).toMatchObject({ ok: true, value: { encryptedMediaId: 'media-1' } });
    expect(secondPhoto).toMatchObject({ ok: true, value: { encryptedMediaId: 'media-2' } });
    expect(photos).toHaveLength(2);
    expect(current.currentLifecycle).toBe('prepared');

    const counted = await application.recordCountObservation({
      ...command(12),
      occurrenceId: current.id,
      photoEvidenceId: photos[1]!.id,
      status: 'counted',
      detectedObjectCount: 8,
      unableReasonCode: null,
      source: 'contour_counter',
      algorithmVersion: 'counter-1',
    });
    expect(counted.ok).toBe(true);
    expect(observations[0]?.detectedObjectCount).toBe(8);
    expect(current.items[0]?.confirmedConsumptionQuantity).toBeNull();
    expect(ledger).toHaveLength(0);

    const confirmed = await application.confirmOccurrenceItems({
      ...command(13),
      occurrenceId: current.id,
      confirmedAtUtc: '2026-08-25T08:10:00.000Z',
      items: [
        {
          occurrenceItemId: current.items[0]!.id,
          assertion: 'partially_taken',
          confirmedConsumptionQuantity: '0.5',
        },
      ],
    });
    expect(confirmed).toMatchObject({
      ok: true,
      value: {
        currentLifecycle: 'taken_confirmed',
        items: [
          {
            plannedDoseQuantity: '1',
            confirmedConsumptionQuantity: '0.5',
          },
        ],
      },
    });
    expect(ledger.map((entry) => entry.quantityDelta)).toEqual(['-0.5']);

    const revised = await application.reviseItemConfirmation({
      ...command(14),
      factId: facts[0]!.id,
      assertion: 'taken_as_planned',
      confirmedConsumptionQuantity: '1',
      confirmedAtUtc: '2026-08-25T08:10:00.000Z',
      reasonCode: 'user_correction',
    });
    expect(revised).toMatchObject({
      ok: true,
      value: { items: [{ confirmedConsumptionQuantity: '1' }] },
    });
    expect(facts).toHaveLength(2);
    expect(ledger.map((entry) => entry.quantityDelta)).toEqual(['-0.5', '0.5', '-1']);
    expect(ledger[1]).toMatchObject({ entryType: 'reversal', reversesEntryId: ledger[0]!.id });
  });

  it('backfills a missed item without deleting its missed event and marks it late', async () => {
    let current = occurrence({ currentLifecycle: 'missed' });
    const facts: PersonalConsumptionAssertionFact[] = [];
    const resolveMissedEvent = vi.fn(async () => undefined);
    const repository = baseRepository({
      getOccurrence: vi.fn(async () => current),
      insertAssertionFact: vi.fn(async (fact) => {
        facts.push(fact);
      }),
      setItemCurrentFromFact: vi.fn(async (fact) => {
        current = {
          ...current,
          items: current.items.map((item) => ({
            ...item,
            assertion: fact.assertion,
            confirmedConsumptionQuantity: fact.confirmedConsumptionQuantity,
            activeFactId: fact.id,
          })),
        };
      }),
      insertInventoryEntry: vi.fn(async () => undefined),
      resolveMissedEvent,
      hasMissedEvent: vi.fn(async () => true),
      updateOccurrenceLifecycle: vi.fn(async (_id, lifecycle) => {
        current = { ...current, currentLifecycle: lifecycle };
      }),
    });
    const result = await createApplication(repository).confirmOccurrenceItems({
      ...command(15),
      occurrenceId: current.id,
      confirmedAtUtc: '2026-08-25T11:00:00.000Z',
      items: [
        {
          occurrenceItemId: current.items[0]!.id,
          assertion: 'taken_as_planned',
          confirmedConsumptionQuantity: '1',
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, value: { currentLifecycle: 'late_taken' } });
    expect(facts[0]).toMatchObject({ source: 'missed_backfill' });
    expect(resolveMissedEvent).toHaveBeenCalledWith(
      'occurrence-item-1',
      facts[0]!.id,
      NOW,
    );
  });

  it('starts a scheduled occurrence early only through the explicit confirmation command', async () => {
    let current = occurrence();
    const updateOccurrenceLifecycle = vi.fn(async (_id, lifecycle) => {
      current = { ...current, currentLifecycle: lifecycle };
    });
    const repository = baseRepository({
      getOccurrence: vi.fn(async () => current),
      updateOccurrenceLifecycle,
    });
    const application = createApplication(repository);
    const result = await application.startOccurrenceEarly({
      ...command(30),
      occurrenceId: current.id,
      currentLocalDate: current.localServiceDate,
    });
    expect(result).toMatchObject({ ok: true, value: { currentLifecycle: 'due' } });
    expect(updateOccurrenceLifecycle).toHaveBeenCalledWith(
      current.id,
      'due',
      'command-30',
      NOW,
      'user_confirmed_early_start',
    );
  });

  it('allows same-day missed evidence without deleting the missed lifecycle', async () => {
    let current = occurrence({ currentLifecycle: 'missed' });
    const photos: PersonalPhotoEvidence[] = [];
    const repository = baseRepository({
      getOccurrence: vi.fn(async () => current),
      getRegimenVersion: vi.fn(async () => VERSION),
      insertPhotoEvidence: vi.fn(async (photo) => {
        photos.push(photo);
      }),
      listPhotoEvidence: vi.fn(async () => photos),
      updateOccurrenceLifecycle: vi.fn(async (_id, lifecycle) => {
        current = { ...current, currentLifecycle: lifecycle };
      }),
    });
    const result = await createApplication(repository).prepareWithPhoto({
      ...command(31),
      occurrenceId: current.id,
      currentLocalDate: current.localServiceDate,
      encryptedMediaId: 'late-media',
      capturedAtUtc: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { capturePurpose: 'initial', encryptedMediaId: 'late-media' },
    });
    expect(current.currentLifecycle).toBe('missed');
  });

  it('appends a retake without changing lifecycle, facts or inventory', async () => {
    const completedItems = occurrence().items.map((item) => ({
      ...item,
      assertion: 'taken_as_planned' as const,
      confirmedConsumptionQuantity: normalizeQuantity('1'),
      activeFactId: 'fact-1',
    }));
    const current = occurrence({ currentLifecycle: 'taken_confirmed', items: completedItems });
    const photos: PersonalPhotoEvidence[] = [];
    const insertInventoryEntry = vi.fn();
    const updateOccurrenceLifecycle = vi.fn();
    const repository = baseRepository({
      getOccurrence: vi.fn(async () => current),
      getRegimenVersion: vi.fn(async () => VERSION),
      insertPhotoEvidence: vi.fn(async (photo) => {
        photos.push(photo);
      }),
      insertInventoryEntry,
      updateOccurrenceLifecycle,
    });
    const result = await createApplication(repository).appendRetakePhoto({
      ...command(32),
      occurrenceId: current.id,
      encryptedMediaId: 'retake-media',
      capturedAtUtc: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { capturePurpose: 'retake', encryptedMediaId: 'retake-media' },
    });
    expect(photos).toHaveLength(1);
    expect(insertInventoryEntry).not.toHaveBeenCalled();
    expect(updateOccurrenceLifecycle).not.toHaveBeenCalled();
  });

  it('forecasts shortage from ledger balance and daily plan without consulting image counts', async () => {
    const preference: InventoryForecastPreference = {
      medicationId: MEDICATION.id,
      leadDays: 7,
      updatedAtUtc: NOW,
      rowVersion: 1,
    };
    const listCountObservations = vi.fn();
    const repository = baseRepository({
      getMedication: vi.fn(async () => MEDICATION),
      getInventoryForecastPreference: vi.fn(async () => preference),
      listInventoryLedger: vi.fn(async (): Promise<PersonalInventoryLedgerEntry[]> => [
        {
          id: 'stock',
          medicationId: MEDICATION.id,
          entryType: 'initial',
          quantityDelta: '2.5' as PersonalInventoryLedgerEntry['quantityDelta'],
          quantityUnit: 'count',
          sourceFactType: 'medication',
          sourceFactId: MEDICATION.id,
          reversesEntryId: null,
          reasonCode: null,
          effectiveAtUtc: NOW,
          recordedAtUtc: NOW,
          commandId: 'seed',
        },
      ]),
      listActiveDailyPlansForMedication: vi.fn(async () => [
        {
          regimenId: REGIMEN.id,
          regimenVersionId: VERSION.id,
          medicationId: MEDICATION.id,
          plannedDoseQuantity: normalizeQuantity('1'),
          localTime: '08:00',
          timeZone: 'UTC',
          effectiveLocalDate: '2026-08-25',
        },
      ]),
      listCountObservations,
    });
    const result = await createApplication(repository).getInventoryForecast(
      MEDICATION.id,
      '2026-08-25',
      '2026-08-25T07:00:00.000Z',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        balanceQuantity: '2.5',
        dailyDoseQuantity: '1',
        fullDoses: 2,
        nextPlannedLocalDate: '2026-08-25',
        estimatedShortageLocalDate: '2026-08-27',
        nominalTriggerAtUtc: '2026-08-20T09:00:00.000Z',
        effectiveTriggerAtUtc: '2026-08-25T07:00:00.000Z',
      },
    });
    expect(listCountObservations).not.toHaveBeenCalled();
  });

  it('does not forecast a paused plan while a disabled reminder still keeps its prediction', async () => {
    const preference: InventoryForecastPreference = {
      medicationId: MEDICATION.id,
      leadDays: 7,
      updatedAtUtc: NOW,
      rowVersion: 1,
    };
    const repository = baseRepository({
      getMedication: vi.fn(async () => MEDICATION),
      getInventoryForecastPreference: vi.fn(async () => preference),
      listInventoryLedger: vi.fn(async () => []),
      listActiveDailyPlansForMedication: vi.fn(async () => []),
    });
    const application = createApplication(repository);
    expect(
      await application.getInventoryForecast(MEDICATION.id, '2026-08-25', NOW),
    ).toMatchObject({
      ok: true,
      value: { unavailableReason: 'no_active_daily_plan', effectiveTriggerAtUtc: null },
    });

    preference.leadDays = null;
    repository.listActiveDailyPlansForMedication = vi.fn(async () => [{
      regimenId: 'regimen-1',
      regimenVersionId: 'version-1',
      medicationId: MEDICATION.id,
      plannedDoseQuantity: normalizeQuantity('1'),
      localTime: '08:00',
      timeZone: 'UTC',
      effectiveLocalDate: '2026-08-25',
    }]);
    expect(
      await application.getInventoryForecast(MEDICATION.id, '2026-08-25', NOW),
    ).toMatchObject({
      ok: true,
      value: {
        unavailableReason: null,
        estimatedShortageLocalDate: '2026-08-25',
        nominalTriggerAtUtc: null,
        effectiveTriggerAtUtc: null,
      },
    });
  });

  it('rebuilds a refill reminder immediately when reconciliation occurs inside the lead window', async () => {
    const preference: InventoryForecastPreference = {
      medicationId: MEDICATION.id,
      leadDays: 7,
      updatedAtUtc: NOW,
      rowVersion: 1,
    };
    const intents: AuxiliaryReminderIntent[] = [];
    const repository = baseRepository({
      getMedication: vi.fn(async () => MEDICATION),
      getInventoryForecastPreference: vi.fn(async () => preference),
      listInventoryForecastPreferences: vi.fn(async () => [preference]),
      listInventoryLedger: vi.fn(async () => []),
      listActiveDailyPlansForMedication: vi.fn(async () => [
        {
          regimenId: REGIMEN.id,
          regimenVersionId: VERSION.id,
          medicationId: MEDICATION.id,
          plannedDoseQuantity: normalizeQuantity('1'),
          localTime: '08:00',
          timeZone: 'UTC',
          effectiveLocalDate: '2026-08-25',
        },
      ]),
      getAuxiliaryReminderIntent: vi.fn(async () => null),
      upsertAuxiliaryReminderIntent: vi.fn(async (intent) => {
        intents.push(intent);
      }),
      getAuxiliaryReminderProjection: vi.fn(async () => null),
      saveAuxiliaryReminderProjection: vi.fn(async () => undefined),
      cancelAuxiliaryReminderIntent: vi.fn(async () => undefined),
      listPendingFollowUpItems: vi.fn(async () => []),
      listActiveAuxiliaryReminderIntents: vi.fn(async () =>
        intents.filter((intent) => intent.status === 'active'),
      ),
    });
    const result = await createApplication(repository).reconcileAuxiliaryReminders({
      ...command(39),
      currentLocalDate: '2026-08-25',
      currentAtUtc: '2026-08-25T07:00:00.000Z',
    });
    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          kind: 'refill',
          sourceId: MEDICATION.id,
          triggerAtUtc: '2026-08-25T07:00:00.000Z',
        },
      ],
    });
  });

  it('creates, edits and completes a follow-up through append-only events and reminder intents', async () => {
    let item: FollowUpItem | null = null;
    const events: FollowUpItemEvent[] = [];
    const intents = new Map<string, AuxiliaryReminderIntent>();
    const projections: unknown[] = [];
    const repository = baseRepository({
      getMedication: vi.fn(async (id) => (id === MEDICATION.id ? MEDICATION : null)),
      getFollowUpItem: vi.fn(async () => item),
      insertFollowUpItem: vi.fn(async (next, event) => {
        item = next;
        events.push(event);
      }),
      updateFollowUpItem: vi.fn(async (next, event) => {
        item = next;
        events.push(event);
      }),
      getAuxiliaryReminderIntent: vi.fn(async (kind, sourceId) =>
        intents.get(`${kind}:${sourceId}`) ?? null,
      ),
      upsertAuxiliaryReminderIntent: vi.fn(async (intent) => {
        intents.set(`${intent.kind}:${intent.sourceId}`, intent);
      }),
      cancelAuxiliaryReminderIntent: vi.fn(async (kind, sourceId, updatedAtUtc) => {
        const key = `${kind}:${sourceId}`;
        const current = intents.get(key);
        if (current) intents.set(key, { ...current, status: 'cancelled', updatedAtUtc });
      }),
      getAuxiliaryReminderProjection: vi.fn(async () => null),
      saveAuxiliaryReminderProjection: vi.fn(async (projection) => {
        projections.push(projection);
      }),
      listFollowUpItemEvents: vi.fn(async () => events),
    });
    const application = createApplication(repository);
    const createInput = {
      ...command(40),
      type: 'test' as const,
      title: '  肝功能检查  ',
      dueAtUtc: '2026-08-30T14:00:00.000Z',
      timeZone: 'UTC',
      medicationId: MEDICATION.id,
      note: '  携带既往结果  ',
      advanceDays: 3 as const,
    };
    const created = await application.createFollowUpItem(createInput);
    const retry = await application.createFollowUpItem(createInput);
    expect(retry).toEqual(created);
    expect(item).toMatchObject({
      status: 'pending',
      title: '肝功能检查',
      note: '携带既往结果',
      rowVersion: 1,
    });
    expect(events.map((event) => event.eventType)).toEqual(['created']);
    expect([...intents.keys()]).toEqual(
      expect.arrayContaining([
        `follow_up_due:${item!.id}`,
        `follow_up_advance:${item!.id}`,
      ]),
    );
    expect(projections).toHaveLength(2);

    const edited = await application.editFollowUpItem({
      ...command(41),
      followUpItemId: item!.id,
      expectedRowVersion: 1,
      changes: { title: '复查肝功能', advanceDays: null },
    });
    expect(edited).toMatchObject({
      ok: true,
      value: { title: '复查肝功能', advanceDays: null, rowVersion: 2 },
    });
    expect(intents.get(`follow_up_advance:${item!.id}`)?.status).toBe('cancelled');

    const completed = await application.completeFollowUpItem({
      ...command(42),
      followUpItemId: item!.id,
      expectedRowVersion: 2,
    });
    expect(completed).toMatchObject({
      ok: true,
      value: { status: 'completed', completedAtUtc: NOW, rowVersion: 3 },
    });
    expect(events.map((event) => event.eventType)).toEqual(['created', 'edited', 'completed']);
    expect(intents.get(`follow_up_due:${item!.id}`)?.status).toBe('cancelled');
  });
});

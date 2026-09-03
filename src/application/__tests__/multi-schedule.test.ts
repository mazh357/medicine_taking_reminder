import { describe, expect, it, vi } from 'vitest';

import type {
  AppProfile,
  PersonalMedication,
  PersonalProcessedCommand,
  PersonalRegimen,
  RegimenVersion,
} from '../../domain';
import { normalizeQuantity } from '../../domain';
import { MedicationApplicationService } from '../MedicationApplicationService';
import type { MedicationRepository } from '../personalPorts';

const NOW = '2026-09-02T00:00:00.000Z';
const PROFILE: AppProfile = {
  id: 'local-profile',
  createdAtUtc: NOW,
  updatedAtUtc: NOW,
  rowVersion: 1,
};

function fixture() {
  const medications = new Map<string, PersonalMedication>();
  const regimens = new Map<string, PersonalRegimen>();
  const versions = new Map<string, RegimenVersion>();
  const processed = new Map<string, PersonalProcessedCommand>();
  const repository = {
    getAppProfile: vi.fn(async () => PROFILE),
    getMedication: vi.fn(async (id: string) => medications.get(id) ?? null),
    insertMedication: vi.fn(async (medication: PersonalMedication) => {
      medications.set(medication.id, medication);
    }),
    insertInventoryForecastPreference: vi.fn(async () => undefined),
    insertInventoryEntry: vi.fn(async () => undefined),
    listRegimensForMedication: vi.fn(async (medicationId: string) =>
      [...regimens.values()].filter((regimen) =>
        versions.get(regimen.currentVersionId)?.items.some(
          (item) => item.medicationId === medicationId,
        ),
      ),
    ),
    getEffectiveRegimenVersion: vi.fn(async (id: string, date: string) => {
      const regimen = regimens.get(id);
      const version = regimen ? versions.get(regimen.currentVersionId) : undefined;
      return version && version.effectiveLocalDate <= date ? version : null;
    }),
    getRegimenVersion: vi.fn(async (id: string) => versions.get(id) ?? null),
    insertRegimen: vi.fn(async (regimen: PersonalRegimen, version: RegimenVersion) => {
      regimens.set(regimen.id, regimen);
      versions.set(version.id, version);
    }),
    appendRegimenRevision: vi.fn(async () => undefined),
    getProcessedCommand: vi.fn(async (type: string, key: string) =>
      processed.get(`${type}:${key}`) ?? null,
    ),
    saveProcessedCommand: vi.fn(async (value: PersonalProcessedCommand) => {
      processed.set(`${value.commandType}:${value.idempotencyKey}`, value);
    }),
  } as unknown as MedicationRepository;
  let id = 0;
  const application = new MedicationApplicationService({
    unitOfWork: { run: async (operation) => operation(repository) },
    ids: { next: () => `id-${++id}` },
    clock: { now: () => NOW },
    fingerprinter: { fingerprint: (value) => JSON.stringify(value) },
    scheduleResolver: {
      resolveDailySchedule: ({ localDate, localTime, onTimeOffsetMinutes, recordOffsetMinutes }) => {
        const scheduled = new Date(`${localDate}T${localTime}:00.000Z`);
        return {
          scheduledAtUtc: scheduled.toISOString(),
          onTimeUntilAtUtc: new Date(scheduled.valueOf() + onTimeOffsetMinutes * 60_000).toISOString(),
          recordUntilAtUtc: new Date(scheduled.valueOf() + recordOffsetMinutes * 60_000).toISOString(),
        };
      },
    },
  });
  return { application, repository, medications, regimens, versions };
}

function schedule(localTime: string, quantity: string) {
  return {
    name: `${localTime}计划`,
    localTime,
    timeZone: 'Asia/Shanghai',
    onTimeOffsetMinutes: 60,
    recordOffsetMinutes: 720,
    captureMode: 'per_item' as const,
    plannedDoseQuantity: quantity,
    startLocalDate: '2026-09-02',
  };
}

function createCommand(schedules: ReturnType<typeof schedule>[]) {
  return {
    commandId: 'command-create',
    idempotencyKey: 'create-three-times',
    issuedAtUtc: NOW,
    payloadSchemaVersion: 2 as const,
    displayName: '同一药物',
    initialInventoryQuantity: '30',
    schedules,
  };
}

describe('one medication with multiple daily schedules', () => {
  it('creates one medication and three independent regimens atomically within one command', async () => {
    const { application, repository, medications, regimens, versions } = fixture();
    const command = createCommand([
      schedule('08:00', '1'),
      schedule('13:00', '0.5'),
      schedule('20:00', '2'),
    ]);

    const first = await application.createMedicationWithSchedules(command);
    const retry = await application.createMedicationWithSchedules(command);

    expect(first.ok).toBe(true);
    expect(retry).toEqual(first);
    expect(medications).toHaveLength(1);
    expect(regimens).toHaveLength(3);
    expect(repository.insertMedication).toHaveBeenCalledTimes(1);
    expect(repository.insertRegimen).toHaveBeenCalledTimes(3);
    expect([...versions.values()].map((version) => version.localTime)).toEqual([
      '08:00',
      '13:00',
      '20:00',
    ]);
    expect([...versions.values()].map((version) => version.items[0]!.plannedDoseQuantity)).toEqual([
      '1',
      '0.5',
      '2',
    ]);
    expect(
      new Set([...versions.values()].map((version) => version.items[0]!.medicationId)).size,
    ).toBe(1);
  });

  it('rejects duplicate times and more than eight schedules before writing any medication', async () => {
    const duplicate = fixture();
    const duplicateResult = await duplicate.application.createMedicationWithSchedules(
      createCommand([schedule('08:00', '1'), schedule('08:00', '2')]),
    );
    expect(duplicateResult).toMatchObject({
      ok: false,
      error: { messageKey: 'error.duplicate_medication_schedule_time' },
    });
    expect(duplicate.medications).toHaveLength(0);

    const tooMany = fixture();
    const tooManyResult = await tooMany.application.createMedicationWithSchedules(
      createCommand(Array.from({ length: 9 }, (_, index) => schedule(`${String(index).padStart(2, '0')}:00`, '1'))),
    );
    expect(tooManyResult).toMatchObject({
      ok: false,
      error: { messageKey: 'error.medication_schedule_count_invalid' },
    });
    expect(tooMany.medications).toHaveLength(0);
  });

  it('treats an already recorded future retirement as immutable and idempotent', async () => {
    const { application, repository } = fixture();
    const retireProjection = vi.fn(async () => undefined);
    repository.getRegimen = vi.fn(async (): Promise<PersonalRegimen> => ({
      id: 'regimen-retiring',
      status: 'active',
      statusEffectiveLocalDate: '2026-09-01',
      currentVersionId: 'version-retiring',
      rowVersion: 2,
      createdAtUtc: NOW,
      updatedAtUtc: NOW,
      retirementEffectiveLocalDate: '2026-09-03',
    }));
    repository.retireRegimen = retireProjection;
    const retireCommand = {
      commandId: 'command-retire-again',
      idempotencyKey: 'retire-again',
      issuedAtUtc: NOW,
      payloadSchemaVersion: 2 as const,
      regimenId: 'regimen-retiring',
      expectedRowVersion: 2,
      currentLocalDate: '2026-09-02',
      currentAtUtc: '2026-09-02T10:00:00.000Z',
    };

    const first = await application.retireRegimen(retireCommand);
    const retry = await application.retireRegimen(retireCommand);

    expect(first).toMatchObject({
      ok: true,
      value: {
        effectiveLocalDate: '2026-09-03',
        effective: 'tomorrow',
        notificationRebuildRequired: false,
      },
    });
    expect(retry).toEqual(first);
    expect(retireProjection).not.toHaveBeenCalled();
  });

  it('defers a medication-level resume when any active schedule has already passed', async () => {
    const { application, repository, medications, regimens, versions } = fixture();
    medications.set('medication-1', {
      id: 'medication-1',
      displayName: '同一药物',
      quantityUnit: 'count',
      status: 'inactive',
      statusEffectiveLocalDate: '2026-09-01',
      createdAtUtc: NOW,
      updatedAtUtc: NOW,
      rowVersion: 1,
    });
    for (const [index, localTime] of ['08:00', '20:00'].entries()) {
      const regimenId = `regimen-${index + 1}`;
      const versionId = `version-${index + 1}`;
      regimens.set(regimenId, {
        id: regimenId,
        status: 'active',
        statusEffectiveLocalDate: '2026-09-01',
        currentVersionId: versionId,
        rowVersion: 1,
        createdAtUtc: NOW,
        updatedAtUtc: NOW,
        retirementEffectiveLocalDate: null,
      });
      versions.set(versionId, {
        id: versionId,
        regimenId,
        versionNumber: 1,
        name: `${localTime}计划`,
        localTime,
        timeZone: 'Asia/Shanghai',
        onTimeOffsetMinutes: 60,
        recordOffsetMinutes: 720,
        captureMode: 'per_item',
        effectiveLocalDate: '2026-09-01',
        effectiveToLocalDate: null,
        supersededAtUtc: null,
        supersedesVersionId: null,
        items: [{
          id: `item-${index + 1}`,
          regimenVersionId: versionId,
          medicationId: 'medication-1',
          plannedDoseQuantity: normalizeQuantity('1'),
          quantityUnit: 'count',
          sortOrder: 0,
        }],
        createdAtUtc: NOW,
      });
    }
    repository.findActiveOccurrence = vi.fn(async () => null);
    repository.listRegimensForDate = vi.fn(async () => [...regimens.values()]);
    repository.insertOccurrence = vi.fn(async () => undefined);
    repository.upsertReminderIntent = vi.fn(async () => undefined);
    repository.saveReminderProjection = vi.fn(async () => undefined);
    repository.setMedicationStatus = vi.fn(async (input) => {
      const medication = medications.get(input.medicationId)!;
      medications.set(input.medicationId, {
        ...medication,
        status: input.status,
        statusEffectiveLocalDate: input.effectiveLocalDate,
        rowVersion: medication.rowVersion + 1,
        updatedAtUtc: input.updatedAtUtc,
      });
    });

    const result = await application.resumeMedication({
      commandId: 'command-resume-medication',
      idempotencyKey: 'resume-medication-after-morning',
      issuedAtUtc: '2026-09-02T12:00:00.000Z',
      payloadSchemaVersion: 2,
      medicationId: 'medication-1',
      expectedRowVersion: 1,
      currentLocalDate: '2026-09-02',
      currentAtUtc: '2026-09-02T12:00:00.000Z',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'active',
        effectiveLocalDate: '2026-09-03',
        effective: 'tomorrow',
        newOccurrenceIds: [],
      },
    });
    expect(repository.setMedicationStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      effectiveLocalDate: '2026-09-03',
    }));

    const sameDayMaterialization = await application.materializeDate({
      commandId: 'command-materialize-after-resume',
      idempotencyKey: 'materialize-after-deferred-resume',
      issuedAtUtc: '2026-09-02T12:01:00.000Z',
      payloadSchemaVersion: 2,
      localDate: '2026-09-02',
    });
    expect(sameDayMaterialization).toEqual({ ok: true, value: [] });
    expect(repository.insertOccurrence).not.toHaveBeenCalled();
  });
});

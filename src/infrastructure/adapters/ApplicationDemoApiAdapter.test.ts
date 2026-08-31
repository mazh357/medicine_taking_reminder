import { describe, expect, it, vi } from 'vitest';

import type {
  DemoApplicationService,
  DemoRepository,
  UnitOfWork,
} from '../../application';
import {
  normalizeQuantity,
  type DoseOccurrence,
  type Medication,
  type Regimen,
} from '../../domain';
import type { PrivateMediaStore } from '../media';
import type { LocalReminderService } from '../notifications';
import { ApplicationDemoApiAdapter } from './ApplicationDemoApiAdapter';
import type { DemoPillCounterAdapter } from './DemoPillCounterAdapter';

const now = new Date('2026-08-24T08:00:00.000Z');

function medication(id: string, displayName: string): Medication {
  return {
    id,
    displayName,
    dosageForm: 'tablet',
    inventoryUnit: 'tablet',
    status: 'active',
    createdAtUtc: now.toISOString(),
  };
}

function regimen(id: string, medicationId: string, localTime: string): Regimen {
  return {
    id,
    name: '演示方案',
    localTime,
    timeZone: 'Asia/Shanghai',
    onTimeOffsetMinutes: 60,
    recordOffsetMinutes: 720,
    captureMode: 'group',
    startLocalDate: '2026-08-24',
    endLocalDate: null,
    status: 'active',
    rowVersion: 1,
    items: [{
      id: `${id}-item`,
      regimenId: id,
      medicationId,
      plannedDoseQuantity: normalizeQuantity('1'),
      unit: 'tablet',
      sortOrder: 0,
    }],
    createdAtUtc: now.toISOString(),
    updatedAtUtc: now.toISOString(),
  };
}

function occurrence(id: string, regimenId: string, medicationId: string): DoseOccurrence {
  return {
    id,
    regimenId,
    localServiceDate: '2026-08-24',
    scheduledAtUtc: now.toISOString(),
    onTimeUntilAtUtc: new Date(now.getTime() + 60_000).toISOString(),
    recordUntilAtUtc: new Date(now.getTime() + 120_000).toISOString(),
    currentLifecycle: 'scheduled',
    rowVersion: 1,
    items: [{
      id: `${id}-item`,
      occurrenceId: id,
      regimenItemId: `${regimenId}-item`,
      medicationId,
      medicationDisplayName: '演示药A',
      plannedDoseQuantity: normalizeQuantity('1'),
      unit: 'tablet',
      sortOrder: 0,
      assertion: 'pending',
      confirmedConsumptionQuantity: null,
      activeFactId: null,
    }],
    createdAtUtc: now.toISOString(),
  };
}

function repositoryForRefresh(): DemoRepository {
  return {
    getProfile: async () => null,
    listMedications: async () => [],
    listOccurrences: async () => [],
    listInventoryLedger: async () => [],
    listActiveRegimensForDate: async () => [],
  } as unknown as DemoRepository;
}

function adapterWith(
  application: Partial<DemoApplicationService>,
  reminders: Partial<LocalReminderService>,
  options: {
    repository?: DemoRepository;
    media?: Partial<PrivateMediaStore>;
  } = {},
) {
  const repository = options.repository ?? repositoryForRefresh();
  const unitOfWork: UnitOfWork = {
    run: async <T>(operation: (candidate: DemoRepository) => Promise<T>) =>
      operation(repository),
  };
  return new ApplicationDemoApiAdapter({
    application: application as DemoApplicationService,
    unitOfWork,
    media: (options.media ?? {}) as PrivateMediaStore,
    counter: {} as DemoPillCounterAdapter,
    reminders: reminders as LocalReminderService,
    nextId: () => '00000000-0000-4000-8000-000000000001',
    now: () => now,
  });
}

describe('ApplicationDemoApiAdapter notification projection', () => {
  it('uses the retake command and keeps the newly saved private photo for a prepared occurrence', async () => {
    const task = { ...occurrence('occ-1', 'regimen-1', 'med-1'), currentLifecycle: 'prepared' as const };
    const repository = {
      ...repositoryForRefresh(),
      getOccurrence: vi.fn().mockResolvedValue(task),
    } as unknown as DemoRepository;
    const prepareWithPhoto = vi.fn();
    const replacePreparedPhoto = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const persistCameraCapture = vi.fn().mockResolvedValue({
      relativePath: 'photos/retake.jpg',
      localUri: 'file:///private/photos/retake.jpg',
    });
    const deletePhoto = vi.fn().mockResolvedValue(undefined);
    const adapter = adapterWith(
      { prepareWithPhoto, replacePreparedPhoto },
      {},
      { repository, media: { persistCameraCapture, deletePhoto } },
    );

    await expect(adapter.saveCapturedPhoto(task.id, 'file:///camera/retake.jpg')).resolves.toBeUndefined();
    expect(replacePreparedPhoto).toHaveBeenCalledWith(expect.objectContaining({
      occurrenceId: task.id,
      privateRelativePath: 'photos/retake.jpg',
    }));
    expect(prepareWithPhoto).not.toHaveBeenCalled();
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it('schedules a daily reminder without blocking creation on permission degradation', async () => {
    const med = medication('med-1', '演示药A');
    const plan = regimen('regimen-1', med.id, '08:30');
    const task = occurrence('occ-1', plan.id, med.id);
    const scheduleDaily = vi.fn().mockResolvedValue({
      status: 'degraded',
      reason: 'permission_denied',
    });
    const adapter = adapterWith(
      {
        createDemoMedication: vi.fn().mockResolvedValue({ ok: true, value: med }),
        createDailyRegimen: vi.fn().mockResolvedValue({ ok: true, value: plan }),
        materializeToday: vi.fn().mockResolvedValue({ ok: true, value: [task] }),
      },
      {
        getCapability: vi.fn().mockResolvedValue({
          status: 'degraded',
          canSchedule: false,
          reason: 'permission_denied',
          canAskAgain: false,
        }),
        scheduleDaily,
      },
    );

    await expect(
      adapter.createMedication({
        name: '演示药A',
        unit: '片',
        plannedDoseQuantity: 1,
        initialInventory: 10,
        reminderTime: '08:30',
      }),
    ).resolves.toBe(med.id);
    expect(scheduleDaily).toHaveBeenCalledWith({
      reminderIntentId: plan.id,
      hour: 8,
      minute: 30,
    });
    expect(adapter.getLastNotificationCapability()).toMatchObject({
      status: 'degraded',
      reason: 'permission_denied',
    });
    expect(adapter.getLastNotificationScheduleResult()).toMatchObject({
      status: 'degraded',
      reason: 'permission_denied',
    });
  });

  it('schedules the one-minute reminder for loaded sample occurrence', async () => {
    const first = medication('med-1', '演示药A');
    const second = medication('med-2', '演示药B');
    const plan = regimen('regimen-1', first.id, '07:59');
    const task = occurrence('occ-1', plan.id, first.id);
    const scheduleOneMinuteDemo = vi.fn().mockResolvedValue({
      status: 'degraded',
      reason: 'permission_undetermined',
    });
    const requestPermission = vi.fn().mockResolvedValue({
      status: 'ready',
      canSchedule: true,
    });
    const adapter = adapterWith(
      {
        acknowledgeDemo: vi.fn().mockResolvedValue({ ok: true, value: { acknowledged: true } }),
        createDemoMedication: vi
          .fn()
          .mockResolvedValueOnce({ ok: true, value: first })
          .mockResolvedValueOnce({ ok: true, value: second }),
        createDailyRegimen: vi.fn().mockResolvedValue({ ok: true, value: plan }),
        materializeToday: vi.fn().mockResolvedValue({ ok: true, value: [task] }),
        markOccurrenceDue: vi.fn().mockResolvedValue({
          ok: true,
          value: { ...task, currentLifecycle: 'due' },
        }),
      },
      {
        getCapability: vi.fn().mockResolvedValue({
          status: 'degraded',
          canSchedule: false,
          reason: 'permission_undetermined',
          canAskAgain: true,
        }),
        requestPermission,
        scheduleOneMinuteDemo,
      },
    );

    await expect(adapter.loadSampleData()).resolves.toBeUndefined();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(scheduleOneMinuteDemo).toHaveBeenCalledWith(task.id);
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  LocalReminderService,
  MEDICATION_REMINDER_CHANNEL_ID,
} from './LocalReminderService';
import type {
  LocalNotificationDriver,
  LocalNotificationRequest,
} from './types';

function fakeDriver(overrides: Partial<LocalNotificationDriver> = {}) {
  const scheduled: LocalNotificationRequest[] = [];
  const driver: LocalNotificationDriver = {
    platform: 'android',
    getPermission: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
    requestPermission: async () => ({ granted: true, canAskAgain: true, status: 'granted' }),
    ensureChannel: vi.fn().mockResolvedValue(undefined),
    schedule: async (request) => {
      scheduled.push(request);
      return 'system-id';
    },
    cancel: vi.fn().mockResolvedValue(undefined),
    cancelAll: vi.fn().mockResolvedValue(undefined),
    configureForegroundPresentation: vi.fn(),
    subscribeToResponses: vi.fn(() => () => undefined),
    ...overrides,
  };
  return { driver, scheduled };
}

describe('LocalReminderService', () => {
  it('degrades without scheduling when permission is denied', async () => {
    const { driver, scheduled } = fakeDriver({
      getPermission: async () => ({ granted: false, canAskAgain: false, status: 'denied' }),
    });
    const service = new LocalReminderService(driver);
    await expect(service.scheduleOneMinuteDemo('occ-1')).resolves.toEqual({
      status: 'degraded',
      reason: 'permission_denied',
    });
    expect(scheduled).toHaveLength(0);
  });

  it('still attempts projection cancellation when scheduling permission is denied', async () => {
    const getPermission = vi.fn(async () => ({
      granted: false,
      canAskAgain: false,
      status: 'denied',
    }));
    const { driver } = fakeDriver({
      getPermission,
    });
    const service = new LocalReminderService(driver);
    await expect(service.cancelProjection('old-system-id')).resolves.toEqual({
      status: 'cancelled',
    });
    expect(getPermission).not.toHaveBeenCalled();
    expect(driver.cancel).toHaveBeenCalledWith('old-system-id');
  });

  it('returns a stable failure code without claiming a failed cancellation succeeded', async () => {
    const { driver } = fakeDriver({
      cancel: vi.fn().mockRejectedValue(new Error('native cancellation failed')),
    });
    const service = new LocalReminderService(driver);
    await expect(service.cancelProjection('old-system-id')).resolves.toEqual({
      status: 'failed',
      failureCode: 'cancellation_error',
    });
  });

  it('uses privacy-preserving product copy for one-minute and daily reminders', async () => {
    const { driver, scheduled } = fakeDriver();
    const service = new LocalReminderService(driver);
    await expect(service.scheduleOneMinuteDemo('occ-1')).resolves.toEqual({
      status: 'scheduled',
      systemNotificationId: 'system-id',
    });
    await service.scheduleDaily({ reminderIntentId: 'intent-1', hour: 8, minute: 30 });
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]!.content.title).toBe('用药提醒');
    expect(scheduled[0]!.content.body).toMatch(/计划的记录时间/);
    expect(scheduled[0]!.content).not.toHaveProperty('sound');
    expect(scheduled[1]!.trigger.type).toBe('daily');
    expect(JSON.stringify(scheduled)).not.toContain('药A');
  });

  it('drops medication names and quantities even if an upstream caller supplies them', async () => {
    const { driver, scheduled } = fakeDriver();
    const service = new LocalReminderService(driver);
    const privateInput = {
      reminderIntentId: 'intent-private',
      occurrenceId: 'occ-private',
      hour: 21,
      minute: 5,
      medicationName: '敏感药名',
      plannedDoseQuantity: 2,
    };

    await service.scheduleDaily(privateInput);

    const serialized = JSON.stringify(scheduled[0]);
    expect(serialized).not.toContain('敏感药名');
    expect(serialized).not.toContain('plannedDoseQuantity');
    expect(scheduled[0]?.content.data).toEqual({
      kind: 'daily_medication_reminder',
      reminderIntentId: 'intent-private',
      occurrenceId: 'occ-private',
      route: '/task/occ-private/capture',
    });
  });

  it('uses the same neutral payload for a dated occurrence reminder', async () => {
    const { driver, scheduled } = fakeDriver();
    const service = new LocalReminderService(driver);

    await service.scheduleAt({
      reminderIntentId: 'intent-dated',
      occurrenceId: 'occ-dated',
      date: new Date('2026-08-25T13:05:00.000Z'),
    });

    expect(scheduled[0]).toMatchObject({
      content: {
        title: '用药提醒',
        body: '现在是计划的记录时间，请打开应用查看。',
        data: {
          kind: 'medication_occurrence',
          reminderIntentId: 'intent-dated',
          occurrenceId: 'occ-dated',
          route: '/task/occ-dated/capture',
        },
      },
      trigger: { type: 'date' },
    });
  });

  it('emits the four auxiliary payloads with only kind, sourceId and route', async () => {
    const { driver, scheduled } = fakeDriver();
    const service = new LocalReminderService(driver);
    await service.scheduleTestReminder('test-source-1');
    await service.scheduleAuxiliaryAt({
      kind: 'refill',
      sourceId: 'refill-source-1',
      date: new Date('2026-09-01T08:00:00.000Z'),
    });
    await service.scheduleAuxiliaryAt({
      kind: 'follow_up_advance',
      sourceId: 'followup-source-1',
      date: new Date('2026-09-02T08:00:00.000Z'),
    });
    await service.scheduleAuxiliaryAt({
      kind: 'follow_up_due',
      sourceId: 'followup-source-1',
      date: new Date('2026-09-03T08:00:00.000Z'),
    });

    expect(scheduled.map((request) => request.content.data)).toEqual([
      { kind: 'test_reminder', sourceId: 'test-source-1', route: 'today' },
      { kind: 'refill', sourceId: 'refill-source-1', route: 'followups' },
      { kind: 'follow_up_advance', sourceId: 'followup-source-1', route: 'followups' },
      { kind: 'follow_up_due', sourceId: 'followup-source-1', route: 'followups' },
    ]);
    expect(scheduled[0]?.trigger).toEqual({
      type: 'timeInterval',
      seconds: 60,
      repeats: false,
      channelId: MEDICATION_REMINDER_CHANNEL_ID,
    });
    expect(scheduled.slice(1).every((request) => request.trigger.type === 'date')).toBe(true);
  });

  it('never copies sensitive refill or follow-up fields into notification content', async () => {
    const { driver, scheduled } = fakeDriver();
    const service = new LocalReminderService(driver);
    const input = {
      kind: 'follow_up_due' as const,
      sourceId: 'opaque-followup-1',
      date: new Date('2026-09-03T08:00:00.000Z'),
      medicationName: '恩替卡韦',
      itemTitle: '乙肝复诊和病毒载量检查',
      note: 'HIV 门诊',
    };
    await service.scheduleAuxiliaryAt(input);

    expect(scheduled[0]?.content).toEqual({
      title: '提醒',
      body: '有一项提醒，请打开应用查看。',
      data: {
        kind: 'follow_up_due',
        sourceId: 'opaque-followup-1',
        route: 'followups',
      },
    });
    const serialized = JSON.stringify(scheduled[0]);
    expect(serialized).not.toContain('恩替卡韦');
    expect(serialized).not.toContain('乙肝');
    expect(serialized).not.toContain('HIV');
  });

  it('cancels a projection and rebuilds one source by cancelling old IDs first', async () => {
    const order: string[] = [];
    const { driver, scheduled } = fakeDriver({
      cancel: vi.fn(async (id: string) => void order.push(`cancel:${id}`)),
      schedule: vi.fn(async (request: LocalNotificationRequest) => {
        scheduled.push(request);
        order.push(`schedule:${request.content.data.kind}`);
        return `new-${request.content.data.kind}`;
      }),
    });
    const service = new LocalReminderService(driver);
    await service.cancelAuxiliary('single-old-id');
    const rebuilt = await service.rebuildAuxiliaryForSource({
      sourceId: 'followup-source-2',
      existingSystemNotificationIds: ['old-advance', 'old-due'],
      reminders: [
        { kind: 'follow_up_advance', date: new Date('2026-10-01T08:00:00.000Z') },
        { kind: 'follow_up_due', date: new Date('2026-10-02T08:00:00.000Z') },
      ],
    });

    expect(order).toEqual([
      'cancel:single-old-id',
      'cancel:old-advance',
      'cancel:old-due',
      'schedule:follow_up_advance',
      'schedule:follow_up_due',
    ]);
    expect(rebuilt.cancelledSystemNotificationIds).toEqual(['old-advance', 'old-due']);
    expect(rebuilt.schedules.map((item) => item.result)).toEqual([
      { status: 'scheduled', systemNotificationId: 'new-follow_up_advance' },
      { status: 'scheduled', systemNotificationId: 'new-follow_up_due' },
    ]);
  });

  it('rejects a human-readable source title instead of leaking it as an identifier', async () => {
    const { driver, scheduled } = fakeDriver();
    const service = new LocalReminderService(driver);
    await expect(
      service.scheduleAuxiliaryAt({
        kind: 'refill',
        sourceId: '高血压药品补充',
        date: new Date('2026-09-01T08:00:00.000Z'),
      }),
    ).rejects.toThrow('opaque identifier');
    expect(scheduled).toHaveLength(0);
  });

  it('validates a rebuild completely before cancelling existing projections', async () => {
    const { driver } = fakeDriver();
    const service = new LocalReminderService(driver);
    await expect(
      service.rebuildAuxiliaryForSource({
        sourceId: 'followup-source-3',
        existingSystemNotificationIds: ['old-safe-projection'],
        reminders: [{ kind: 'follow_up_due', date: new Date('invalid') }],
      }),
    ).rejects.toThrow('date must be valid');
    expect(driver.cancel).not.toHaveBeenCalled();
  });
});

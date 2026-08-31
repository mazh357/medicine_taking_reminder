import type {
  AuxiliaryReminderKind,
  AuxiliaryReminderRoute,
  AuxiliaryReminderScheduleResult,
  DailyReminderInput,
  DatedAuxiliaryReminderInput,
  DatedReminderInput,
  LocalNotificationDriver,
  NotificationCapability,
  NotificationCancellationResult,
  NotificationDegradedReason,
  NotificationScheduleResult,
  NotificationResponsePayload,
  RebuildAuxiliaryRemindersInput,
  RebuildAuxiliaryRemindersResult,
} from './types';

export const MEDICATION_REMINDER_CHANNEL_ID = 'medication-reminders-v2';
/** @deprecated Use MEDICATION_REMINDER_CHANNEL_ID. */
export const DEMO_REMINDER_CHANNEL_ID = MEDICATION_REMINDER_CHANNEL_ID;

function nonEmptyIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) throw new Error(`${name} is invalid`);
  return normalized;
}

function opaqueSourceIdentifier(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(normalized)) {
    throw new Error('sourceId must be an opaque identifier');
  }
  return normalized;
}

function validDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${name} must be valid`);
  }
  return value;
}

function auxiliaryRoute(kind: AuxiliaryReminderKind): AuxiliaryReminderRoute {
  return kind === 'test_reminder' ? 'today' : 'followups';
}

export class LocalReminderService {
  constructor(private readonly driver: LocalNotificationDriver) {}

  async initialize(): Promise<NotificationCapability> {
    try {
      this.driver.configureForegroundPresentation();
      if (this.driver.platform === 'android') {
        await this.driver.ensureChannel(MEDICATION_REMINDER_CHANNEL_ID);
      }
      return this.getCapability();
    } catch {
      return this.degraded('notifications_unavailable', false);
    }
  }

  async getCapability(): Promise<NotificationCapability> {
    try {
      const permission = await this.driver.getPermission();
      if (permission.granted) return { status: 'ready', canSchedule: true };
      if (permission.status === 'undetermined') {
        return this.degraded('permission_undetermined', permission.canAskAgain);
      }
      return this.degraded('permission_denied', permission.canAskAgain);
    } catch {
      return this.degraded('notifications_unavailable', false);
    }
  }

  async requestPermission(): Promise<NotificationCapability> {
    try {
      const permission = await this.driver.requestPermission();
      if (permission.granted) return { status: 'ready', canSchedule: true };
      return this.degraded('permission_denied', permission.canAskAgain);
    } catch {
      return this.degraded('notifications_unavailable', false);
    }
  }

  async scheduleOneMinuteDemo(occurrenceId: string): Promise<NotificationScheduleResult> {
    const id = nonEmptyIdentifier(occurrenceId, 'occurrenceId');
    const capability = await this.getCapability();
    if (!capability.canSchedule) return { status: 'degraded', reason: capability.reason };
    try {
      const systemNotificationId = await this.driver.schedule({
        content: {
          title: '用药提醒',
          body: '现在是计划的记录时间，请打开应用查看。',
          data: { kind: 'medication_occurrence', occurrenceId: id, route: `/task/${id}/capture` },
        },
        trigger: {
          type: 'timeInterval',
          seconds: 60,
          repeats: false,
          channelId: MEDICATION_REMINDER_CHANNEL_ID,
        },
      });
      return { status: 'scheduled', systemNotificationId };
    } catch {
      return { status: 'degraded', reason: 'scheduling_error' };
    }
  }

  /** Schedules a neutral test notification exactly one minute from now. */
  async scheduleTestReminder(sourceId: string): Promise<NotificationScheduleResult> {
    const normalizedSourceId = opaqueSourceIdentifier(sourceId);
    const capability = await this.getCapability();
    if (!capability.canSchedule) return { status: 'degraded', reason: capability.reason };
    try {
      const systemNotificationId = await this.driver.schedule({
        content: this.auxiliaryContent('test_reminder', normalizedSourceId),
        trigger: {
          type: 'timeInterval',
          seconds: 60,
          repeats: false,
          channelId: MEDICATION_REMINDER_CHANNEL_ID,
        },
      });
      return { status: 'scheduled', systemNotificationId };
    } catch {
      return { status: 'degraded', reason: 'scheduling_error' };
    }
  }

  /** Schedules a refill/follow-up projection at an absolute local device time. */
  async scheduleAuxiliaryAt(
    input: DatedAuxiliaryReminderInput,
  ): Promise<NotificationScheduleResult> {
    const sourceId = opaqueSourceIdentifier(input.sourceId);
    const date = validDate(input.date, 'date');
    const capability = await this.getCapability();
    if (!capability.canSchedule) return { status: 'degraded', reason: capability.reason };
    try {
      const systemNotificationId = await this.driver.schedule({
        content: this.auxiliaryContent(input.kind, sourceId),
        trigger: {
          type: 'date',
          date,
          channelId: MEDICATION_REMINDER_CHANNEL_ID,
        },
      });
      return { status: 'scheduled', systemNotificationId };
    } catch {
      return { status: 'degraded', reason: 'scheduling_error' };
    }
  }

  /**
   * Replaces the persisted system projections belonging to one opaque source.
   * The caller remains responsible for committing returned projection IDs.
   */
  async rebuildAuxiliaryForSource(
    input: RebuildAuxiliaryRemindersInput,
  ): Promise<RebuildAuxiliaryRemindersResult> {
    const sourceId = opaqueSourceIdentifier(input.sourceId);
    const existingSystemNotificationIds = [
      ...new Set(
        input.existingSystemNotificationIds.map((id) =>
          nonEmptyIdentifier(id, 'systemNotificationId'),
        ),
      ),
    ];
    const reminders = input.reminders.map((reminder) => ({
      kind: reminder.kind,
      date: validDate(reminder.date, 'date'),
    }));
    const cancelledSystemNotificationIds: string[] = [];
    for (const systemNotificationId of existingSystemNotificationIds) {
      await this.driver.cancel(systemNotificationId);
      cancelledSystemNotificationIds.push(systemNotificationId);
    }

    const schedules: AuxiliaryReminderScheduleResult[] = [];
    for (const reminder of reminders) {
      const scheduledAt = reminder.date;
      schedules.push({
        kind: reminder.kind,
        sourceId,
        scheduledAt,
        result: await this.scheduleAuxiliaryAt({
          kind: reminder.kind,
          sourceId,
          date: scheduledAt,
        }),
      });
    }
    return { sourceId, cancelledSystemNotificationIds, schedules };
  }

  async scheduleDaily(input: DailyReminderInput): Promise<NotificationScheduleResult> {
    const reminderIntentId = nonEmptyIdentifier(input.reminderIntentId, 'reminderIntentId');
    if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) {
      throw new Error('hour must be an integer from 0 to 23');
    }
    if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) {
      throw new Error('minute must be an integer from 0 to 59');
    }
    const capability = await this.getCapability();
    if (!capability.canSchedule) return { status: 'degraded', reason: capability.reason };
    const occurrenceId = input.occurrenceId?.trim();
    try {
      const systemNotificationId = await this.driver.schedule({
        content: {
          title: '用药提醒',
          body: '请打开应用查看今天的用药计划。',
          data: {
            kind: 'daily_medication_reminder',
            reminderIntentId,
            route: occurrenceId ? `/task/${occurrenceId}/capture` : '/',
            ...(occurrenceId ? { occurrenceId } : {}),
          },
        },
        trigger: {
          type: 'daily',
          hour: input.hour,
          minute: input.minute,
          channelId: MEDICATION_REMINDER_CHANNEL_ID,
        },
      });
      return { status: 'scheduled', systemNotificationId };
    } catch {
      return { status: 'degraded', reason: 'scheduling_error' };
    }
  }

  async scheduleAt(input: DatedReminderInput): Promise<NotificationScheduleResult> {
    const reminderIntentId = nonEmptyIdentifier(input.reminderIntentId, 'reminderIntentId');
    const occurrenceId = nonEmptyIdentifier(input.occurrenceId, 'occurrenceId');
    if (!(input.date instanceof Date) || !Number.isFinite(input.date.getTime())) {
      throw new Error('date must be valid');
    }
    const capability = await this.getCapability();
    if (!capability.canSchedule) return { status: 'degraded', reason: capability.reason };
    try {
      const systemNotificationId = await this.driver.schedule({
        content: {
          title: '用药提醒',
          body: '现在是计划的记录时间，请打开应用查看。',
          data: {
            kind: 'medication_occurrence',
            reminderIntentId,
            occurrenceId,
            route: `/task/${occurrenceId}/capture`,
          },
        },
        trigger: {
          type: 'date',
          date: input.date,
          channelId: MEDICATION_REMINDER_CHANNEL_ID,
        },
      });
      return { status: 'scheduled', systemNotificationId };
    } catch {
      return { status: 'degraded', reason: 'scheduling_error' };
    }
  }

  async cancel(systemNotificationId: string): Promise<void> {
    await this.driver.cancel(nonEmptyIdentifier(systemNotificationId, 'systemNotificationId'));
  }

  /** Cancellation never checks scheduling permission; revoked permission must not block cleanup. */
  async cancelProjection(
    systemNotificationId: string,
  ): Promise<NotificationCancellationResult> {
    try {
      await this.cancel(systemNotificationId);
      return { status: 'cancelled' };
    } catch {
      return { status: 'failed', failureCode: 'cancellation_error' };
    }
  }

  /** Explicit alias used by auxiliary projection repositories. */
  async cancelAuxiliary(systemNotificationId: string): Promise<void> {
    await this.cancel(systemNotificationId);
  }

  clearAll(): Promise<void> {
    return this.driver.cancelAll();
  }

  subscribeToResponses(
    listener: (payload: NotificationResponsePayload) => void,
  ): () => void {
    return this.driver.subscribeToResponses(listener);
  }

  private degraded(
    reason: NotificationDegradedReason,
    canAskAgain: boolean,
  ): NotificationCapability {
    return { status: 'degraded', canSchedule: false, reason, canAskAgain };
  }

  private auxiliaryContent(kind: AuxiliaryReminderKind, sourceId: string) {
    return {
      title: '提醒',
      body:
        kind === 'test_reminder'
          ? '这是一条测试提醒，请打开应用查看。'
          : '有一项提醒，请打开应用查看。',
      data: { kind, sourceId, route: auxiliaryRoute(kind) },
    };
  }
}

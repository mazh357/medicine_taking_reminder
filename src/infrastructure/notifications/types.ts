export type NotificationDegradedReason =
  | 'permission_undetermined'
  | 'permission_denied'
  | 'notifications_unavailable'
  | 'scheduling_error';

export type NotificationCapability =
  | { status: 'ready'; canSchedule: true }
  | {
      status: 'degraded';
      canSchedule: false;
      reason: NotificationDegradedReason;
      canAskAgain: boolean;
    };

export type NotificationScheduleResult =
  | { status: 'scheduled'; systemNotificationId: string }
  | { status: 'degraded'; reason: NotificationDegradedReason };

export type NotificationCancellationResult =
  | { status: 'cancelled' }
  | { status: 'failed'; failureCode: 'cancellation_error' };

export interface DailyReminderInput {
  reminderIntentId: string;
  hour: number;
  minute: number;
  occurrenceId?: string;
}

export interface DatedReminderInput {
  reminderIntentId: string;
  occurrenceId: string;
  date: Date;
}

export type AuxiliaryReminderKind =
  | 'test_reminder'
  | 'refill'
  | 'follow_up_advance'
  | 'follow_up_due';

export type DatedAuxiliaryReminderKind = Exclude<AuxiliaryReminderKind, 'test_reminder'>;

export type AuxiliaryReminderRoute = 'today' | 'followups';

export interface DatedAuxiliaryReminderInput {
  kind: DatedAuxiliaryReminderKind;
  /** Opaque local entity identifier. It must not contain a human-readable title. */
  sourceId: string;
  date: Date;
}

export interface AuxiliaryReminderScheduleResult {
  kind: AuxiliaryReminderKind;
  sourceId: string;
  scheduledAt: Date;
  result: NotificationScheduleResult;
}

export interface RebuildAuxiliaryRemindersInput {
  sourceId: string;
  /** System projection IDs previously persisted for this source. */
  existingSystemNotificationIds: readonly string[];
  reminders: readonly {
    kind: DatedAuxiliaryReminderKind;
    date: Date;
  }[];
}

export interface RebuildAuxiliaryRemindersResult {
  sourceId: string;
  cancelledSystemNotificationIds: string[];
  schedules: AuxiliaryReminderScheduleResult[];
}

export interface NotificationPermissionSnapshot {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

export interface NotificationResponsePayload {
  route: string;
  kind?: AuxiliaryReminderKind;
  sourceId?: string;
  occurrenceId?: string;
  reminderIntentId?: string;
}

export type LocalNotificationRequest = {
  content: {
    title: string;
    body: string;
    data: Record<string, string>;
  };
  trigger:
    | { type: 'timeInterval'; seconds: number; repeats: false; channelId: string }
    | { type: 'date'; date: Date; channelId: string }
    | { type: 'daily'; hour: number; minute: number; channelId: string };
};

export interface LocalNotificationDriver {
  readonly platform: string;
  getPermission(): Promise<NotificationPermissionSnapshot>;
  requestPermission(): Promise<NotificationPermissionSnapshot>;
  ensureChannel(channelId: string): Promise<void>;
  schedule(request: LocalNotificationRequest): Promise<string>;
  cancel(systemNotificationId: string): Promise<void>;
  cancelAll(): Promise<void>;
  configureForegroundPresentation(): void;
  subscribeToResponses(listener: (payload: NotificationResponsePayload) => void): () => void;
}

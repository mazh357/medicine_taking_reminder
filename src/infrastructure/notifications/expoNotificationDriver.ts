import { Platform } from 'react-native';

import type {
  AuxiliaryReminderKind,
  LocalNotificationDriver,
  LocalNotificationRequest,
  NotificationPermissionSnapshot,
  NotificationResponsePayload,
} from './types';

const AUXILIARY_KINDS = new Set<AuxiliaryReminderKind>([
  'test_reminder',
  'refill',
  'follow_up_advance',
  'follow_up_due',
]);

async function notificationModule() {
  return import('expo-notifications');
}

function permissionSnapshot(input: {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}): NotificationPermissionSnapshot {
  return {
    granted: input.granted,
    canAskAgain: input.canAskAgain,
    status: input.status,
  };
}

function safeResponsePayload(data: Record<string, unknown>): NotificationResponsePayload | null {
  const route = data.route;
  if (
    typeof route !== 'string' ||
    route.length > 240 ||
    !(
      route === '/' ||
      route === 'today' ||
      route === 'followups' ||
      /^\/task\/[A-Za-z0-9-]{1,160}\/capture$/.test(route)
    )
  ) {
    return null;
  }
  const occurrenceId =
    typeof data.occurrenceId === 'string' && /^[A-Za-z0-9-]{1,160}$/.test(data.occurrenceId)
      ? data.occurrenceId
      : undefined;
  const reminderIntentId =
    typeof data.reminderIntentId === 'string' &&
    /^[A-Za-z0-9-]{1,160}$/.test(data.reminderIntentId)
      ? data.reminderIntentId
      : undefined;
  const kind =
    typeof data.kind === 'string' && AUXILIARY_KINDS.has(data.kind as AuxiliaryReminderKind)
      ? (data.kind as AuxiliaryReminderKind)
      : undefined;
  const sourceId =
    typeof data.sourceId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(data.sourceId)
      ? data.sourceId
      : undefined;
  const carriesAuxiliaryFields = data.kind !== undefined || data.sourceId !== undefined;
  if (
    carriesAuxiliaryFields &&
    (!kind || !sourceId || auxiliaryRouteForResponse(kind) !== route)
  ) {
    return null;
  }
  if ((route === 'today' || route === 'followups') && !carriesAuxiliaryFields) return null;
  return {
    route,
    ...(kind ? { kind } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(occurrenceId ? { occurrenceId } : {}),
    ...(reminderIntentId ? { reminderIntentId } : {}),
  };
}

function auxiliaryRouteForResponse(kind: AuxiliaryReminderKind): 'today' | 'followups' {
  return kind === 'test_reminder' ? 'today' : 'followups';
}

export const expoLocalNotificationDriver: LocalNotificationDriver = {
  platform: Platform.OS,
  async getPermission() {
    return permissionSnapshot(await (await notificationModule()).getPermissionsAsync());
  },
  async requestPermission() {
    return permissionSnapshot(await (await notificationModule()).requestPermissionsAsync());
  },
  async ensureChannel(channelId) {
    const Notifications = await notificationModule();
    await Notifications.setNotificationChannelAsync(channelId, {
      name: '用药提醒',
      description: '长期用药助手的本地计划提醒',
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  },
  async schedule(request: LocalNotificationRequest) {
    const Notifications = await notificationModule();
    return Notifications.scheduleNotificationAsync({
      content: request.content,
      trigger: request.trigger,
    });
  },
  async cancel(systemNotificationId) {
    await (await notificationModule()).cancelScheduledNotificationAsync(systemNotificationId);
  },
  async cancelAll() {
    await (await notificationModule()).cancelAllScheduledNotificationsAsync();
  },
  configureForegroundPresentation() {
    void notificationModule().then((Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    });
  },
  subscribeToResponses(listener) {
    let removed = false;
    let removeNative: (() => void) | undefined;
    void notificationModule().then((Notifications) => {
      if (removed) return;
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const payload = safeResponsePayload(response.notification.request.content.data ?? {});
        if (payload) listener(payload);
      });
      removeNative = () => subscription.remove();
    });
    return () => {
      removed = true;
      removeNative?.();
    };
  },
};

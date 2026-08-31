import { describe, expect, it, vi } from 'vitest';

const notificationMocks = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn().mockResolvedValue(undefined),
  responseListener: undefined as ((response: unknown) => void) | undefined,
  removeResponseListener: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 'default' },
  AndroidNotificationVisibility: { PRIVATE: 'private' },
  setNotificationChannelAsync: notificationMocks.setNotificationChannelAsync,
  addNotificationResponseReceivedListener: vi.fn((listener: (response: unknown) => void) => {
    notificationMocks.responseListener = listener;
    return { remove: notificationMocks.removeResponseListener };
  }),
}));

// Mock declarations must precede the module-under-test import.
// eslint-disable-next-line import/first
import { expoLocalNotificationDriver } from './expoNotificationDriver';

describe('expoLocalNotificationDriver privacy boundary', () => {
  it('creates the Android reminder channel with private lock-screen visibility', async () => {
    await expoLocalNotificationDriver.ensureChannel('medication-reminders-v2');

    expect(notificationMocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      'medication-reminders-v2',
      expect.objectContaining({
        name: '用药提醒',
        lockscreenVisibility: 'private',
      }),
    );
  });

  it('accepts only the four neutral auxiliary click routes and strips extra data', async () => {
    const received: unknown[] = [];
    const unsubscribe = expoLocalNotificationDriver.subscribeToResponses((payload) => {
      received.push(payload);
    });
    await vi.waitFor(() => expect(notificationMocks.responseListener).toBeTypeOf('function'));

    for (const [kind, route] of [
      ['test_reminder', 'today'],
      ['refill', 'followups'],
      ['follow_up_advance', 'followups'],
      ['follow_up_due', 'followups'],
    ] as const) {
      notificationMocks.responseListener?.({
        notification: {
          request: {
            content: {
              data: {
                kind,
                route,
                sourceId: `source-${kind}`,
                medicationName: '敏感药名',
                itemTitle: '敏感事项',
              },
            },
          },
        },
      });
    }

    expect(received).toEqual([
      { kind: 'test_reminder', route: 'today', sourceId: 'source-test_reminder' },
      { kind: 'refill', route: 'followups', sourceId: 'source-refill' },
      {
        kind: 'follow_up_advance',
        route: 'followups',
        sourceId: 'source-follow_up_advance',
      },
      { kind: 'follow_up_due', route: 'followups', sourceId: 'source-follow_up_due' },
    ]);
    expect(JSON.stringify(received)).not.toContain('敏感');
    unsubscribe();
    expect(notificationMocks.removeResponseListener).toHaveBeenCalledOnce();
  });

  it('rejects an auxiliary payload whose route does not match its kind', async () => {
    const listener = vi.fn();
    expoLocalNotificationDriver.subscribeToResponses(listener);
    await vi.waitFor(() => expect(notificationMocks.responseListener).toBeTypeOf('function'));
    notificationMocks.responseListener?.({
      notification: {
        request: {
          content: {
            data: { kind: 'refill', route: 'today', sourceId: 'source-refill' },
          },
        },
      },
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

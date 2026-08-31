import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));
vi.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: vi.fn(),
  dismissAllNotificationsAsync: vi.fn(),
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
vi.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '/databases',
  deleteDatabaseAsync: vi.fn(),
}));

// Mock declarations must precede the module-under-test import.
// eslint-disable-next-line import/first
import {
  prepareLegacyDataCleanup,
  type LegacyCleanupDriver,
} from './legacyDataCleanup';

function driver(marker: string | null): LegacyCleanupDriver {
  return {
    marker: vi.fn().mockResolvedValue(marker),
    setMarker: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn(async (uri: string) => uri.endsWith('demo-media')),
    deleteUri: vi.fn().mockResolvedValue(undefined),
    deleteLegacyDatabase: vi.fn().mockResolvedValue(undefined),
    cancelLegacyNotifications: vi.fn().mockResolvedValue(undefined),
    legacyUris: ['file:///db/old.db', 'file:///documents/demo-media'],
  };
}

describe('prepareLegacyDataCleanup', () => {
  it('clears known demo artifacts but writes the marker only after schema success', async () => {
    const cleanup = driver(null);
    const prepared = await prepareLegacyDataCleanup(cleanup);
    expect(prepared.legacyDataCleared).toBe(true);
    expect(cleanup.deleteLegacyDatabase).toHaveBeenCalledOnce();
    expect(cleanup.cancelLegacyNotifications).toHaveBeenCalledOnce();
    expect(cleanup.setMarker).not.toHaveBeenCalled();
    await prepared.finalizeAfterSecureSchema();
    expect(cleanup.setMarker).toHaveBeenCalledOnce();
  });

  it('is idempotent after the completion marker', async () => {
    const cleanup = driver('1');
    const prepared = await prepareLegacyDataCleanup(cleanup);
    expect(prepared.alreadyComplete).toBe(true);
    expect(cleanup.deleteUri).not.toHaveBeenCalled();
    expect(cleanup.cancelLegacyNotifications).not.toHaveBeenCalled();
  });
});

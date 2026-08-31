import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { defaultDatabaseDirectory, deleteDatabaseAsync } from 'expo-sqlite';

import { LegacyDataCleanupError } from './securityErrors';

const LEGACY_DATABASE_NAME = 'medication-demo-v0.1.db';
const CLEANUP_MARKER_KEY = 'personal-v2-legacy-cleanup-complete';
const CLEANUP_MARKER_VALUE = '1';
const CLEANUP_MARKER_SERVICE = 'com.helpusurvive.medicationdemo.upgrade-state';

export interface LegacyCleanupDriver {
  marker(): Promise<string | null>;
  setMarker(): Promise<void>;
  exists(uri: string): Promise<boolean>;
  deleteUri(uri: string): Promise<void>;
  deleteLegacyDatabase(): Promise<void>;
  cancelLegacyNotifications(): Promise<void>;
  legacyUris: readonly string[];
}

export interface LegacyCleanupPreparation {
  alreadyComplete: boolean;
  legacyDataCleared: boolean;
  finalizeAfterSecureSchema(): Promise<void>;
}

export async function prepareLegacyDataCleanup(
  driver: LegacyCleanupDriver,
): Promise<LegacyCleanupPreparation> {
  let marker: string | null;
  try {
    marker = await driver.marker();
  } catch {
    throw new LegacyDataCleanupError();
  }
  if (marker === CLEANUP_MARKER_VALUE) {
    return {
      alreadyComplete: true,
      legacyDataCleared: false,
      finalizeAfterSecureSchema: async () => undefined,
    };
  }

  try {
    const presence = await Promise.all(driver.legacyUris.map((uri) => driver.exists(uri)));
    const legacyDataCleared = presence.some(Boolean);
    await driver.cancelLegacyNotifications();
    await driver.deleteLegacyDatabase();
    await Promise.all(driver.legacyUris.map((uri) => driver.deleteUri(uri)));
    return {
      alreadyComplete: false,
      legacyDataCleared,
      finalizeAfterSecureSchema: async () => {
        try {
          await driver.setMarker();
        } catch {
          throw new LegacyDataCleanupError();
        }
      },
    };
  } catch (error) {
    if (error instanceof LegacyDataCleanupError) throw error;
    throw new LegacyDataCleanupError();
  }
}

function fileUri(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('file://') ? normalized : `file://${normalized}`;
}

function joinUri(base: string | null, child: string): string | null {
  return base ? `${base.replace(/\/+$/, '')}/${child}` : null;
}

const databaseBase = fileUri(String(defaultDatabaseDirectory));
const legacyUris = [
  `${databaseBase}/${LEGACY_DATABASE_NAME}`,
  `${databaseBase}/${LEGACY_DATABASE_NAME}-wal`,
  `${databaseBase}/${LEGACY_DATABASE_NAME}-shm`,
  joinUri(FileSystem.documentDirectory, 'demo-media'),
  joinUri(FileSystem.cacheDirectory, 'demo-media'),
  joinUri(FileSystem.cacheDirectory, 'decrypted-media'),
].filter((uri): uri is string => uri !== null);

export const expoLegacyCleanupDriver: LegacyCleanupDriver = {
  marker: () =>
    SecureStore.getItemAsync(CLEANUP_MARKER_KEY, {
      keychainService: CLEANUP_MARKER_SERVICE,
    }),
  setMarker: () =>
    SecureStore.setItemAsync(CLEANUP_MARKER_KEY, CLEANUP_MARKER_VALUE, {
      keychainService: CLEANUP_MARKER_SERVICE,
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  exists: async (uri) => (await FileSystem.getInfoAsync(uri)).exists,
  deleteUri: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  deleteLegacyDatabase: () =>
    deleteDatabaseAsync(LEGACY_DATABASE_NAME).catch(async () => {
      // The direct, idempotent cleanup below remains authoritative for a database
      // left by an older native SQLite build.
      await FileSystem.deleteAsync(`${databaseBase}/${LEGACY_DATABASE_NAME}`, {
        idempotent: true,
      });
    }),
  cancelLegacyNotifications: async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.dismissAllNotificationsAsync();
  },
  legacyUris,
};

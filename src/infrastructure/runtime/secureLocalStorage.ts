import { AppState, type NativeEventSubscription } from 'react-native';

import {
  AppPrivateMediaStore,
  expoEncryptedMediaDriver,
  secureMediaId,
} from '../media';
import {
  expoLegacyCleanupDriver,
  prepareLegacyDataCleanup,
  type LegacyCleanupDriver,
} from './legacyDataCleanup';
import {
  openSecurePersonalDatabase,
  type SecureDatabaseDependencies,
  type SecureDatabaseHandle,
} from './securePersonalDatabase';

export interface SecureLocalStorageRuntime {
  storage: SecureDatabaseHandle;
  media: AppPrivateMediaStore;
  startupNotice: { legacyDataCleared: boolean };
  destroyAfterExplicitDataClear(): Promise<void>;
  dispose(): Promise<void>;
}

export interface SecureLocalStorageDependencies {
  database?: SecureDatabaseDependencies;
  legacyCleanup?: LegacyCleanupDriver;
  subscribeToBackground?(cleanup: () => void): NativeEventSubscription;
}

/**
 * Security gate for all personal-data repositories. Callers must not construct a
 * repository until this function has returned successfully.
 */
export async function initializeSecureLocalStorage(
  dependencies: SecureLocalStorageDependencies = {},
): Promise<SecureLocalStorageRuntime> {
  const media = new AppPrivateMediaStore(expoEncryptedMediaDriver, secureMediaId);
  await media.cleanupDecryptedCache();
  const cleanup = await prepareLegacyDataCleanup(
    dependencies.legacyCleanup ?? expoLegacyCleanupDriver,
  );
  const storage = await openSecurePersonalDatabase(dependencies.database);
  try {
    await cleanup.finalizeAfterSecureSchema();
  } catch (error) {
    await storage.close().catch(() => undefined);
    throw error;
  }

  const subscription = (dependencies.subscribeToBackground ?? subscribeToBackground)(() => {
    void media.cleanupDecryptedCache();
  });
  let subscriptionRemoved = false;
  const removeSubscription = () => {
    if (subscriptionRemoved) return;
    subscriptionRemoved = true;
    subscription.remove();
  };
  return {
    storage,
    media,
    startupNotice: { legacyDataCleared: cleanup.legacyDataCleared },
    destroyAfterExplicitDataClear: async () => {
      removeSubscription();
      await media.cleanupDecryptedCache().catch(() => undefined);
      await storage.destroyAfterExplicitDataClear();
    },
    dispose: async () => {
      removeSubscription();
      await media.cleanupDecryptedCache().catch(() => undefined);
      await storage.close();
    },
  };
}

function subscribeToBackground(cleanup: () => void): NativeEventSubscription {
  return AppState.addEventListener('change', (state) => {
    if (state !== 'active') cleanup();
  });
}

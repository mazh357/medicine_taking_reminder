import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import {
  DatabaseKeyInvalidError,
  DatabaseKeyUnavailableError,
} from './securityErrors';

const DATABASE_KEY_NAME = 'personal-database-key-v1';
const DATABASE_CLEAR_PENDING_NAME = 'personal-database-clear-pending-v1';
const DATABASE_KEY_SERVICE = 'com.helpusurvive.medicationdemo.personal-database';
const SQLCIPHER_KEY_PATTERN = /^[0-9a-f]{64}$/;

export interface SecretStorePort {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  delete(): Promise<void>;
}

export interface ExplicitDataClearMarkerPort {
  get(): Promise<boolean>;
  set(): Promise<void>;
  delete(): Promise<void>;
}

export interface DatabaseKeyProvider {
  loadOrCreate(databaseExists: boolean): Promise<string>;
  isExplicitDataClearPending(): Promise<boolean>;
  markExplicitDataClearPending(): Promise<void>;
  destroyAfterExplicitDataClear(): Promise<void>;
}

export class SecureDatabaseKeyProvider implements DatabaseKeyProvider {
  constructor(
    private readonly secretStore: SecretStorePort,
    private readonly randomBytes: (length: number) => Promise<Uint8Array>,
    private readonly clearMarker: ExplicitDataClearMarkerPort,
  ) {}

  async loadOrCreate(databaseExists: boolean): Promise<string> {
    let stored: string | null;
    try {
      stored = await this.secretStore.get();
    } catch {
      throw new DatabaseKeyUnavailableError();
    }

    if (stored !== null) {
      if (!SQLCIPHER_KEY_PATTERN.test(stored)) throw new DatabaseKeyInvalidError();
      return stored;
    }
    if (databaseExists) throw new DatabaseKeyUnavailableError();

    const bytes = await this.randomBytes(32).catch(() => {
      throw new DatabaseKeyUnavailableError();
    });
    if (bytes.length !== 32) throw new DatabaseKeyUnavailableError();
    const created = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    try {
      await this.secretStore.set(created);
    } catch {
      throw new DatabaseKeyUnavailableError();
    }
    return created;
  }

  async isExplicitDataClearPending(): Promise<boolean> {
    try {
      return await this.clearMarker.get();
    } catch {
      throw new DatabaseKeyUnavailableError();
    }
  }

  async markExplicitDataClearPending(): Promise<void> {
    try {
      await this.clearMarker.set();
    } catch {
      throw new DatabaseKeyUnavailableError();
    }
  }

  async destroyAfterExplicitDataClear(): Promise<void> {
    try {
      // The marker is intentionally removed last. If either deletion fails,
      // startup will retry the destructive cleanup before opening a database.
      await this.secretStore.delete();
      await this.clearMarker.delete();
    } catch {
      throw new DatabaseKeyUnavailableError();
    }
  }
}

const expoSecretStore: SecretStorePort = {
  get: () =>
    SecureStore.getItemAsync(DATABASE_KEY_NAME, {
      keychainService: DATABASE_KEY_SERVICE,
      requireAuthentication: false,
    }),
  set: (value) =>
    SecureStore.setItemAsync(DATABASE_KEY_NAME, value, {
      keychainService: DATABASE_KEY_SERVICE,
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  delete: () =>
    SecureStore.deleteItemAsync(DATABASE_KEY_NAME, {
      keychainService: DATABASE_KEY_SERVICE,
    }),
};

const expoClearMarker: ExplicitDataClearMarkerPort = {
  get: async () =>
    (await SecureStore.getItemAsync(DATABASE_CLEAR_PENDING_NAME, {
      keychainService: DATABASE_KEY_SERVICE,
      requireAuthentication: false,
    })) === '1',
  set: () =>
    SecureStore.setItemAsync(DATABASE_CLEAR_PENDING_NAME, '1', {
      keychainService: DATABASE_KEY_SERVICE,
      requireAuthentication: false,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  delete: () =>
    SecureStore.deleteItemAsync(DATABASE_CLEAR_PENDING_NAME, {
      keychainService: DATABASE_KEY_SERVICE,
    }),
};

export const expoDatabaseKeyProvider = new SecureDatabaseKeyProvider(
  expoSecretStore,
  Crypto.getRandomBytesAsync,
  expoClearMarker,
);

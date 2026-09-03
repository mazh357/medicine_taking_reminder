import * as FileSystem from 'expo-file-system/legacy';
import {
  defaultDatabaseDirectory,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import {
  adaptExpoSQLite,
  initializePersonalDatabaseV6,
  type SqlDatabase,
} from '../storage';
import {
  type DatabaseKeyProvider,
  expoDatabaseKeyProvider,
} from './databaseKeyStore';
import { DatabaseAuthenticationError } from './securityErrors';

export const PERSONAL_DATABASE_NAME = 'medication-personal-v0.2.db';

export interface SecureDatabaseHandle {
  database: SqlDatabase;
  rawDatabase: SQLiteDatabase;
  close(): Promise<void>;
  destroyAfterExplicitDataClear(): Promise<void>;
}

export interface SecureDatabaseDependencies {
  databaseExists(): Promise<boolean>;
  deleteDatabaseFiles(): Promise<void>;
  open(): Promise<SQLiteDatabase>;
  keyProvider: DatabaseKeyProvider;
  initialize(database: SqlDatabase, appliedAtUtc: string): Promise<void>;
  nowUtc(): string;
}

export async function openSecurePersonalDatabase(
  dependencies: SecureDatabaseDependencies = expoSecureDatabaseDependencies,
): Promise<SecureDatabaseHandle> {
  if (await dependencies.keyProvider.isExplicitDataClearPending()) {
    await dependencies.deleteDatabaseFiles();
    await dependencies.keyProvider.destroyAfterExplicitDataClear();
  }
  const existedBeforeOpen = await dependencies.databaseExists();
  const keyHex = await dependencies.keyProvider.loadOrCreate(existedBeforeOpen);
  const rawDatabase = await dependencies.open();
  const database = adaptExpoSQLite(rawDatabase);

  try {
    // keyHex is strictly validated as 64 lowercase hexadecimal characters by
    // DatabaseKeyProvider; never include this statement in logs or error text.
    await rawDatabase.execAsync(`PRAGMA key = "x'${keyHex}'";`);
    const cipher = await rawDatabase.getFirstAsync<{ cipher_version: string }>(
      'PRAGMA cipher_version;',
    );
    if (!cipher?.cipher_version) throw new DatabaseAuthenticationError();
    // Do not use the prepared-statement convenience APIs for this probe. An
    // older test build may have left a plaintext or otherwise incompatible
    // database under the current filename. On Android, expo-sqlite finalizes a
    // convenience statement in `finally`; SQLCipher's NOTADB error path has
    // been observed to crash natively in exsqlite3_finalize before JavaScript
    // can surface the authentication failure. sqlite3_exec performs the same
    // authenticated schema read without exposing a NativeStatement lifecycle.
    await rawDatabase.execAsync('SELECT count(*) FROM sqlite_master;');
  } catch {
    await rawDatabase.closeAsync().catch(() => undefined);
    throw new DatabaseAuthenticationError();
  }

  try {
    await dependencies.initialize(database, dependencies.nowUtc());
  } catch (error) {
    await rawDatabase.closeAsync().catch(() => undefined);
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  const close = async () => {
    if (!closePromise) {
      closePromise = rawDatabase.closeAsync().catch((error) => {
        closePromise = undefined;
        throw error;
      });
    }
    await closePromise;
  };
  return {
    database,
    rawDatabase,
    close,
    destroyAfterExplicitDataClear: async () => {
      await dependencies.keyProvider.markExplicitDataClearPending();
      await close();
      // Never destroy the only decryption key until every database file has
      // been deleted successfully. The durable marker makes every stage safe
      // to retry after a process interruption.
      await dependencies.deleteDatabaseFiles();
      await dependencies.keyProvider.destroyAfterExplicitDataClear();
    },
  };
}

function databaseUri(suffix = ''): string {
  const base = String(defaultDatabaseDirectory).replace(/\\/g, '/').replace(/\/+$/, '');
  const normalized = base.startsWith('file://') ? base : `file://${base}`;
  return `${normalized}/${PERSONAL_DATABASE_NAME}${suffix}`;
}

async function deletePersonalDatabaseFiles(): Promise<void> {
  const uris = [databaseUri('-wal'), databaseUri('-shm'), databaseUri()];
  for (const uri of uris) await FileSystem.deleteAsync(uri, { idempotent: true });
  const remaining = await Promise.all(uris.map((uri) => FileSystem.getInfoAsync(uri)));
  if (remaining.some((entry) => entry.exists)) {
    throw new Error('Personal database files could not be deleted');
  }
}

export const expoSecureDatabaseDependencies: SecureDatabaseDependencies = {
  databaseExists: async () => (await FileSystem.getInfoAsync(databaseUri())).exists,
  deleteDatabaseFiles: deletePersonalDatabaseFiles,
  open: () =>
    openDatabaseAsync(PERSONAL_DATABASE_NAME, {
      useNewConnection: true,
      // Every statement owned by this app is created through expo-sqlite's
      // run/get convenience APIs and is explicitly finalized by those APIs.
      // Disabling the additional close-time sqlite3_next_stmt sweep avoids a
      // known Android native double-finalize class while preserving normal
      // close semantics and all database files.
      finalizeUnusedStatementsBeforeClosing: false,
    }),
  keyProvider: expoDatabaseKeyProvider,
  initialize: initializePersonalDatabaseV6,
  nowUtc: () => new Date().toISOString(),
};

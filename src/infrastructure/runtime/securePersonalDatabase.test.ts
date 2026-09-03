import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system/legacy', () => ({
  getInfoAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));
vi.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '/databases',
  openDatabaseAsync: vi.fn(),
}));
vi.mock('../storage', () => ({
  adaptExpoSQLite: vi.fn(() => ({})),
  initializePersonalDatabaseV6: vi.fn(),
}));
vi.mock('./databaseKeyStore', () => ({
  expoDatabaseKeyProvider: {
    loadOrCreate: vi.fn(),
    isExplicitDataClearPending: vi.fn(),
    markExplicitDataClearPending: vi.fn(),
    destroyAfterExplicitDataClear: vi.fn(),
  },
}));

// Mock declarations must precede the module-under-test import.
// eslint-disable-next-line import/first
import {
  expoSecureDatabaseDependencies,
  openSecurePersonalDatabase,
  type SecureDatabaseDependencies,
} from './securePersonalDatabase';
// eslint-disable-next-line import/first
import * as FileSystem from 'expo-file-system/legacy';
// eslint-disable-next-line import/first
import { openDatabaseAsync } from 'expo-sqlite';
// eslint-disable-next-line import/first
import { initializePersonalDatabaseV6 } from '../storage';
// eslint-disable-next-line import/first
import { DatabaseAuthenticationError, DatabaseKeyUnavailableError } from './securityErrors';

function dependencies(overrides: Partial<SecureDatabaseDependencies> = {}) {
  const rawDatabase = {
    execAsync: vi.fn().mockResolvedValue(undefined),
    getFirstAsync: vi.fn(
      async (sql: string): Promise<{ cipher_version?: string; count?: number } | null> =>
        sql === 'PRAGMA cipher_version;' ? { cipher_version: '4.6.1' } : { count: 1 },
    ),
    closeAsync: vi.fn().mockResolvedValue(undefined),
  };
  const keyProvider = {
    loadOrCreate: vi.fn().mockResolvedValue('ab'.repeat(32)),
    isExplicitDataClearPending: vi.fn().mockResolvedValue(false),
    markExplicitDataClearPending: vi.fn().mockResolvedValue(undefined),
    destroyAfterExplicitDataClear: vi.fn().mockResolvedValue(undefined),
  };
  const value: SecureDatabaseDependencies = {
    databaseExists: vi.fn().mockResolvedValue(true),
    deleteDatabaseFiles: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(rawDatabase),
    keyProvider,
    initialize: vi.fn().mockResolvedValue(undefined),
    nowUtc: () => '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
  return { value, rawDatabase, keyProvider };
}

describe('openSecurePersonalDatabase safety boundary', () => {
  it('binds the production encrypted runtime to schema v6 initialization', () => {
    expect(expoSecureDatabaseDependencies.initialize).toBe(initializePersonalDatabaseV6);
  });

  it('opens an isolated connection without the native close-time statement sweep', async () => {
    vi.mocked(openDatabaseAsync).mockResolvedValue({} as never);

    await expoSecureDatabaseDependencies.open();

    expect(openDatabaseAsync).toHaveBeenCalledWith('medication-personal-v0.2.db', {
      useNewConnection: true,
      finalizeUnusedStatementsBeforeClosing: false,
    });
  });

  it('does not open, recreate or clear an existing database when its key is unavailable', async () => {
    const fixture = dependencies();
    fixture.keyProvider.loadOrCreate.mockRejectedValue(new DatabaseKeyUnavailableError());

    await expect(openSecurePersonalDatabase(fixture.value)).rejects.toBeInstanceOf(
      DatabaseKeyUnavailableError,
    );
    expect(fixture.value.open).not.toHaveBeenCalled();
    expect(fixture.value.initialize).not.toHaveBeenCalled();
    expect(fixture.keyProvider.destroyAfterExplicitDataClear).not.toHaveBeenCalled();
  });

  it('closes but never destroys data or keys when SQLCipher authentication fails', async () => {
    const fixture = dependencies();
    fixture.rawDatabase.getFirstAsync.mockResolvedValue(null);

    await expect(openSecurePersonalDatabase(fixture.value)).rejects.toBeInstanceOf(
      DatabaseAuthenticationError,
    );
    expect(fixture.rawDatabase.closeAsync).toHaveBeenCalledOnce();
    expect(fixture.value.initialize).not.toHaveBeenCalled();
    expect(fixture.keyProvider.destroyAfterExplicitDataClear).not.toHaveBeenCalled();
  });

  it('uses an exec probe so an incompatible old database never enters statement finalization', async () => {
    const fixture = dependencies();
    fixture.rawDatabase.execAsync.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT count(*) FROM sqlite_master;') {
        throw new Error('file is not a database');
      }
    });

    await expect(openSecurePersonalDatabase(fixture.value)).rejects.toBeInstanceOf(
      DatabaseAuthenticationError,
    );

    expect(fixture.rawDatabase.execAsync).toHaveBeenNthCalledWith(
      2,
      'SELECT count(*) FROM sqlite_master;',
    );
    expect(fixture.rawDatabase.getFirstAsync).toHaveBeenCalledOnce();
    expect(fixture.rawDatabase.getFirstAsync).toHaveBeenCalledWith('PRAGMA cipher_version;');
    expect(fixture.rawDatabase.closeAsync).toHaveBeenCalledOnce();
    expect(fixture.value.initialize).not.toHaveBeenCalled();
    expect(fixture.value.deleteDatabaseFiles).not.toHaveBeenCalled();
    expect(fixture.keyProvider.destroyAfterExplicitDataClear).not.toHaveBeenCalled();
  });

  it('closes without destroying keys when secure schema initialization fails', async () => {
    const fixture = dependencies({
      initialize: vi.fn().mockRejectedValue(new Error('schema failed')),
    });

    await expect(openSecurePersonalDatabase(fixture.value)).rejects.toThrow('schema failed');
    expect(fixture.rawDatabase.closeAsync).toHaveBeenCalledOnce();
    expect(fixture.keyProvider.destroyAfterExplicitDataClear).not.toHaveBeenCalled();
  });

  it('deletes database files before destroying the key and is safe to close again', async () => {
    const order: string[] = [];
    const fixture = dependencies({
      deleteDatabaseFiles: vi.fn(async () => void order.push('files')),
    });
    fixture.rawDatabase.closeAsync.mockImplementation(async () => void order.push('close'));
    fixture.keyProvider.markExplicitDataClearPending.mockImplementation(
      async () => void order.push('marker'),
    );
    fixture.keyProvider.destroyAfterExplicitDataClear.mockImplementation(
      async () => void order.push('key'),
    );
    const handle = await openSecurePersonalDatabase(fixture.value);

    await handle.destroyAfterExplicitDataClear();
    await handle.close();

    expect(order).toEqual(['marker', 'close', 'files', 'key']);
    expect(fixture.rawDatabase.closeAsync).toHaveBeenCalledOnce();
  });

  it('preserves the key and pending marker when database-file deletion fails, then retries', async () => {
    const fixture = dependencies();
    const deletion = vi
      .fn()
      .mockRejectedValueOnce(new Error('file busy'))
      .mockResolvedValueOnce(undefined);
    fixture.value.deleteDatabaseFiles = deletion;
    const handle = await openSecurePersonalDatabase(fixture.value);

    await expect(handle.destroyAfterExplicitDataClear()).rejects.toThrow('file busy');
    expect(fixture.keyProvider.markExplicitDataClearPending).toHaveBeenCalledOnce();
    expect(fixture.keyProvider.destroyAfterExplicitDataClear).not.toHaveBeenCalled();

    await expect(handle.destroyAfterExplicitDataClear()).resolves.toBeUndefined();
    expect(deletion).toHaveBeenCalledTimes(2);
    expect(fixture.keyProvider.destroyAfterExplicitDataClear).toHaveBeenCalledOnce();
  });

  it('finishes an interrupted explicit clear before opening a fresh database', async () => {
    const order: string[] = [];
    const fixture = dependencies({
      databaseExists: vi.fn(async () => {
        order.push('exists');
        return false;
      }),
      deleteDatabaseFiles: vi.fn(async () => void order.push('files')),
    });
    fixture.keyProvider.isExplicitDataClearPending.mockResolvedValue(true);
    fixture.keyProvider.destroyAfterExplicitDataClear.mockImplementation(
      async () => void order.push('key'),
    );
    fixture.keyProvider.loadOrCreate.mockImplementation(async (exists: boolean) => {
      order.push(`load:${exists}`);
      return 'ab'.repeat(32);
    });

    await openSecurePersonalDatabase(fixture.value);

    expect(order).toEqual(['files', 'key', 'exists', 'load:false']);
  });

  it('deletes and verifies the WAL, SHM and main database files', async () => {
    vi.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: false } as never);

    await expoSecureDatabaseDependencies.deleteDatabaseFiles();

    expect(vi.mocked(FileSystem.deleteAsync).mock.calls.map(([uri]) => uri)).toEqual([
      'file:///databases/medication-personal-v0.2.db-wal',
      'file:///databases/medication-personal-v0.2.db-shm',
      'file:///databases/medication-personal-v0.2.db',
    ]);
    expect(FileSystem.getInfoAsync).toHaveBeenCalledTimes(3);
  });
});

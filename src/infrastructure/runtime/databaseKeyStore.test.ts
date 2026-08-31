import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

// Mock declarations must precede the module-under-test import.
// eslint-disable-next-line import/first
import {
  SecureDatabaseKeyProvider,
  type ExplicitDataClearMarkerPort,
  type SecretStorePort,
} from './databaseKeyStore';
// eslint-disable-next-line import/first
import {
  DatabaseKeyInvalidError,
  DatabaseKeyUnavailableError,
} from './securityErrors';

function secrets(initial: string | null): SecretStorePort & { set: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn().mockResolvedValue(initial),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function marker(initial = false): ExplicitDataClearMarkerPort {
  return {
    get: vi.fn().mockResolvedValue(initial),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SecureDatabaseKeyProvider', () => {
  it('creates exactly 256 bits only for a new database', async () => {
    const store = secrets(null);
    const random = vi.fn().mockResolvedValue(Uint8Array.from({ length: 32 }, (_, i) => i));
    const provider = new SecureDatabaseKeyProvider(store, random, marker());
    const key = await provider.loadOrCreate(false);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(random).toHaveBeenCalledWith(32);
    expect(store.set).toHaveBeenCalledWith(key);
  });

  it('never creates a replacement when an existing database has no key', async () => {
    const store = secrets(null);
    const random = vi.fn();
    const provider = new SecureDatabaseKeyProvider(store, random, marker());
    await expect(provider.loadOrCreate(true)).rejects.toBeInstanceOf(
      DatabaseKeyUnavailableError,
    );
    expect(random).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('rejects malformed stored material without overwriting it', async () => {
    const store = secrets('not-a-key');
    const provider = new SecureDatabaseKeyProvider(store, vi.fn(), marker());
    await expect(provider.loadOrCreate(false)).rejects.toBeInstanceOf(
      DatabaseKeyInvalidError,
    );
    expect(store.set).not.toHaveBeenCalled();
  });

  it('keeps the durable marker until the database key has been deleted', async () => {
    const order: string[] = [];
    const store = secrets('ab'.repeat(32));
    const clearMarker = marker(true);
    store.delete = vi.fn(async () => void order.push('key'));
    clearMarker.delete = vi.fn(async () => void order.push('marker'));
    const provider = new SecureDatabaseKeyProvider(store, vi.fn(), clearMarker);

    await provider.destroyAfterExplicitDataClear();

    expect(order).toEqual(['key', 'marker']);
  });

  it('reports a pending explicit clear through its durable marker', async () => {
    const clearMarker = marker(true);
    const provider = new SecureDatabaseKeyProvider(secrets('ab'.repeat(32)), vi.fn(), clearMarker);

    await expect(provider.isExplicitDataClearPending()).resolves.toBe(true);
    await provider.markExplicitDataClearPending();

    expect(clearMarker.set).toHaveBeenCalledOnce();
  });
});

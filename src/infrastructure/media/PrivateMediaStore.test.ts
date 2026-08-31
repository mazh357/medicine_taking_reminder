import { describe, expect, it, vi } from 'vitest';

import { AppPrivateMediaStore } from './PrivateMediaStore';
import type { EncryptedMediaDriver } from './types';

function driver(overrides: Partial<EncryptedMediaDriver> = {}): EncryptedMediaDriver {
  return {
    stageCameraFile: vi.fn().mockResolvedValue('file:///app/cache/camera-staging/12345678.jpg'),
    encryptCameraFile: vi.fn().mockResolvedValue({
      relativePath: 'encrypted-media/photos/12345678.med1',
      mediaFormatVersion: 1,
    }),
    createPreview: vi.fn().mockResolvedValue('content://app.encryptedmedia/decrypted/preview.jpg'),
    deleteEncryptedFile: vi.fn().mockResolvedValue(undefined),
    deletePreview: vi.fn().mockResolvedValue(undefined),
    clearPreviewCache: vi.fn().mockResolvedValue(undefined),
    clearAllEncryptedMedia: vi.fn().mockResolvedValue(undefined),
    getMediaKeyStatus: vi.fn().mockResolvedValue({
      available: true,
      hardwareBacked: true,
      mediaFormatVersion: 1,
    }),
    deleteTemporaryFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AppPrivateMediaStore', () => {
  it('persists only an opaque encrypted-media reference', async () => {
    const encryptedDriver = driver();
    const store = new AppPrivateMediaStore(encryptedDriver, () => '12345678');
    const result = await store.persistCameraCapture(
      { uri: 'file:///app/cache/camera.jpg' },
      'occ-1',
      new Date('2026-08-24T00:00:00.000Z'),
    );
    expect(result).toEqual({
      relativePath: 'encrypted-media/photos/12345678.med1',
      mediaFormatVersion: 1,
    });
    expect(encryptedDriver.encryptCameraFile).toHaveBeenCalledWith(
      'file:///app/cache/camera-staging/12345678.jpg',
      '12345678',
    );
    expect(encryptedDriver.stageCameraFile).toHaveBeenCalledWith(
      'file:///app/cache/camera.jpg',
      '12345678',
    );
    expect(encryptedDriver.deleteTemporaryFile).toHaveBeenCalledWith(
      'file:///app/cache/camera.jpg',
    );
    expect(encryptedDriver.deleteTemporaryFile).toHaveBeenCalledWith(
      'file:///app/cache/camera-staging/12345678.jpg',
    );
    expect(result).not.toHaveProperty('localUri');
  });

  it('deletes temporary plaintext after encryption failure', async () => {
    const encryptedDriver = driver({
      encryptCameraFile: vi.fn().mockRejectedValue(new Error('native failure')),
    });
    const store = new AppPrivateMediaStore(encryptedDriver, () => '12345678');
    await expect(
      store.persistCameraCapture({ uri: 'file:///app/cache/camera.jpg' }, 'occ-1'),
    ).rejects.toThrow('native failure');
    expect(encryptedDriver.deleteTemporaryFile).toHaveBeenCalledWith(
      'file:///app/cache/camera.jpg',
    );
    expect(encryptedDriver.deleteTemporaryFile).toHaveBeenCalledWith(
      'file:///app/cache/camera-staging/12345678.jpg',
    );
  });

  it('cleans the original camera file when staging fails', async () => {
    const encryptedDriver = driver({
      stageCameraFile: vi.fn().mockRejectedValue(new Error('source unreadable')),
    });
    const store = new AppPrivateMediaStore(encryptedDriver, () => '12345678');
    await expect(
      store.persistCameraCapture({ uri: 'file:///app/cache/missing.jpg' }, 'occ-1'),
    ).rejects.toThrow('source unreadable');
    expect(encryptedDriver.encryptCameraFile).not.toHaveBeenCalled();
    expect(encryptedDriver.deleteTemporaryFile).toHaveBeenCalledTimes(1);
    expect(encryptedDriver.deleteTemporaryFile).toHaveBeenCalledWith(
      'file:///app/cache/missing.jpg',
    );
  });

  it('uses only short-lived content previews and rejects direct paths', async () => {
    const encryptedDriver = driver();
    const store = new AppPrivateMediaStore(encryptedDriver, () => '12345678');
    const preview = await store.createDecryptedPreview(
      'encrypted-media/photos/12345678.med1',
    );
    expect(preview.uri).toMatch(/^content:\/\//);
    expect(() =>
      store.resolvePrivateUri('encrypted-media/photos/12345678.med1'),
    ).toThrow('short-lived preview');
    await store.deletePreview(preview.uri);
    expect(encryptedDriver.deletePreview).toHaveBeenCalledWith(preview.uri);
  });

  it('rejects network, traversal and unexpected media format inputs', async () => {
    const encryptedDriver = driver();
    const store = new AppPrivateMediaStore(encryptedDriver, () => '12345678');
    await expect(
      store.persistCameraCapture({ uri: 'https://example.test/photo.jpg' }, 'occ-1'),
    ).rejects.toThrow();
    expect(() => store.resolvePrivateUri('../outside.med1')).toThrow();

    const wrongVersion = driver({
      encryptCameraFile: vi.fn().mockResolvedValue({
        relativePath: 'encrypted-media/photos/12345678.med1',
        mediaFormatVersion: 2,
      }),
    });
    await expect(
      new AppPrivateMediaStore(wrongVersion, () => '12345678').persistCameraCapture(
        { uri: 'file:///app/cache/photo.jpg' },
        'occ-1',
      ),
    ).rejects.toThrow('Unsupported encrypted media format');
    expect(wrongVersion.deleteEncryptedFile).toHaveBeenCalled();
  });
});

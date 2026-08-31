import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

import LocalDataCrypto from '../../../modules/local-data-crypto';
import {
  PhotoSaveError,
  type EncryptedMediaDriver,
  type PhotoSaveErrorCode,
} from './types';

const CAMERA_STAGING_DIRECTORY = `${FileSystem.cacheDirectory ?? ''}camera-staging/`;
const SAFE_STAGING_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;

function nativeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '');
  }
  return error instanceof Error ? error.message : String(error);
}

function classifiedError(
  error: unknown,
  fallback: PhotoSaveErrorCode,
  fallbackMessage: string,
): PhotoSaveError {
  if (error instanceof PhotoSaveError) return error;
  const code = nativeErrorCode(error);
  if (/ENOSPC|no space left|ERR_MEDIA_STORAGE_FULL/i.test(code)) {
    return new PhotoSaveError('storage_full', 'There is not enough space to save the photo', {
      cause: error,
    });
  }
  if (/ERR_MEDIA_KEY_UNAVAILABLE/i.test(code)) {
    return new PhotoSaveError('key_unavailable', 'The photo encryption key is unavailable', {
      cause: error,
    });
  }
  if (/ENOENT|not found|unavailable|cannot read|ERR_MEDIA_SOURCE_UNREADABLE/i.test(code)) {
    return new PhotoSaveError('source_unreadable', 'The captured photo cannot be read', {
      cause: error,
    });
  }
  if (/ERR_MEDIA_PATH/i.test(code)) {
    return new PhotoSaveError('unsupported_path', 'Camera file reference is unsupported', {
      cause: error,
    });
  }
  return new PhotoSaveError(fallback, fallbackMessage, { cause: error });
}

export const expoEncryptedMediaDriver: EncryptedMediaDriver = {
  stageCameraFile: async (sourceUri, stagingId) => {
    if (!FileSystem.cacheDirectory || !SAFE_STAGING_ID.test(stagingId)) {
      throw new PhotoSaveError('unsupported_path', 'Camera staging path is unavailable');
    }
    if (!/^file:\/\//i.test(sourceUri)) {
      throw new PhotoSaveError('unsupported_path', 'Camera file reference is unsupported');
    }
    const stagedUri = `${CAMERA_STAGING_DIRECTORY}${stagingId}.jpg`;
    try {
      const source = await FileSystem.getInfoAsync(sourceUri);
      if (!source.exists || source.isDirectory) {
        throw new PhotoSaveError('source_unreadable', 'The captured photo cannot be read');
      }
      await FileSystem.makeDirectoryAsync(CAMERA_STAGING_DIRECTORY, { intermediates: true });
      await FileSystem.deleteAsync(stagedUri, { idempotent: true });
      await FileSystem.copyAsync({ from: sourceUri, to: stagedUri });
      const staged = await FileSystem.getInfoAsync(stagedUri);
      if (!staged.exists || staged.isDirectory || (typeof staged.size === 'number' && staged.size < 1)) {
        throw new PhotoSaveError('source_unreadable', 'The staged photo cannot be read');
      }
      return stagedUri;
    } catch (error) {
      await FileSystem.deleteAsync(stagedUri, { idempotent: true }).catch(() => undefined);
      throw classifiedError(error, 'source_unreadable', 'The captured photo cannot be staged');
    }
  },
  encryptCameraFile: async (sourceUri, photoId) => {
    try {
      const result = await LocalDataCrypto.encryptCameraFile(sourceUri, photoId);
      return {
        relativePath: result.relativePath,
        mediaFormatVersion: result.formatVersion,
      };
    } catch (error) {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => undefined);
      throw classifiedError(error, 'encryption_failed', 'Photo encryption failed');
    }
  },
  createPreview: (relativePath, previewId) =>
    LocalDataCrypto.createPreview(relativePath, previewId),
  deleteEncryptedFile: (relativePath) =>
    LocalDataCrypto.deleteEncryptedFile(relativePath),
  deletePreview: (previewUri) => LocalDataCrypto.deletePreview(previewUri),
  clearPreviewCache: () => LocalDataCrypto.clearPreviewCache(),
  clearAllEncryptedMedia: () => LocalDataCrypto.clearAllEncryptedMedia(),
  getMediaKeyStatus: () => LocalDataCrypto.getMediaKeyStatus(),
  deleteTemporaryFile: (uri) =>
    FileSystem.deleteAsync(uri, { idempotent: true }),
};

/** Cryptographically random opaque identifier; it carries no patient metadata. */
export function secureMediaId(): string {
  return Crypto.randomUUID().replace(/-/g, '');
}

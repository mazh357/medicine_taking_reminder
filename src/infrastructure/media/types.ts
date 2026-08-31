export interface CameraCaptureResult {
  uri: string;
  width?: number;
  height?: number;
  format?: 'jpg' | 'png';
}

export interface StoredPrivatePhoto {
  /** Opaque path relative to Android filesDir; safe to persist, never render directly. */
  relativePath: string;
  mediaFormatVersion: number;
}

export interface DecryptedPreview {
  /** Opaque FileProvider URI. The backing cache file must be deleted after use. */
  uri: string;
}

export interface MediaEncryptionStatus {
  available: boolean;
  hardwareBacked: boolean | null;
  mediaFormatVersion: number;
}

export type PhotoSaveErrorCode =
  | 'camera_unavailable'
  | 'camera_result_missing'
  | 'unsupported_path'
  | 'source_unreadable'
  | 'storage_full'
  | 'key_unavailable'
  | 'encryption_failed'
  | 'commit_failed';

export class PhotoSaveError extends Error {
  constructor(
    public readonly code: PhotoSaveErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PhotoSaveError';
  }
}

export interface PrivateMediaStore {
  persistCameraCapture(
    capture: CameraCaptureResult,
    occurrenceId: string,
    capturedAt?: Date,
  ): Promise<StoredPrivatePhoto>;
  createDecryptedPreview(relativePath: string): Promise<DecryptedPreview>;
  deletePreview(previewUri: string): Promise<void>;
  cleanupDecryptedCache(): Promise<void>;
  encryptionStatus(): Promise<MediaEncryptionStatus>;
  /** Compatibility tripwire: encrypted evidence cannot be exposed as a direct file URI. */
  resolvePrivateUri(relativePath: string): never;
  deletePhoto(relativePath: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface EncryptedMediaDriver {
  stageCameraFile(sourceUri: string, stagingId: string): Promise<string>;
  encryptCameraFile(sourceUri: string, photoId: string): Promise<StoredPrivatePhoto>;
  createPreview(relativePath: string, previewId: string): Promise<string>;
  deleteEncryptedFile(relativePath: string): Promise<void>;
  deletePreview(previewUri: string): Promise<void>;
  clearPreviewCache(): Promise<void>;
  clearAllEncryptedMedia(): Promise<void>;
  getMediaKeyStatus(): Promise<MediaEncryptionStatus>;
  deleteTemporaryFile(uri: string): Promise<void>;
}

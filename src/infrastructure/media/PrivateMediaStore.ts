import { PhotoSaveError } from './types';
import type {
  CameraCaptureResult,
  DecryptedPreview,
  EncryptedMediaDriver,
  MediaEncryptionStatus,
  PrivateMediaStore,
  StoredPrivatePhoto,
} from './types';

const CAMERA_URI_PATTERN = /^file:\/\//i;
const SAFE_RELATIVE_PATH =
  /^encrypted-media\/photos\/[A-Za-z0-9][A-Za-z0-9_-]{7,79}\.med1$/;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;

export class AppPrivateMediaStore implements PrivateMediaStore {
  constructor(
    private readonly driver: EncryptedMediaDriver,
    private readonly nextOpaqueId: () => string,
  ) {}

  async persistCameraCapture(
    capture: CameraCaptureResult,
    occurrenceId: string,
    capturedAt = new Date(),
  ): Promise<StoredPrivatePhoto> {
    if (!occurrenceId.trim()) throw new Error('Occurrence identifier is required');
    return this.persistPrivateCapture(capture, capturedAt);
  }

  async persistPrivateCapture(capture: CameraCaptureResult, capturedAt = new Date()): Promise<StoredPrivatePhoto> {
    if (!CAMERA_URI_PATTERN.test(capture.uri)) {
      throw new PhotoSaveError('unsupported_path', 'Camera file reference is unsupported');
    }
    if (!Number.isFinite(capturedAt.getTime())) throw new Error('Invalid capture time');
    const photoId = this.requireOpaqueId(this.nextOpaqueId());
    let stagedUri: string | undefined;
    try {
      stagedUri = await this.driver.stageCameraFile(capture.uri, photoId);
      const stored = await this.driver.encryptCameraFile(stagedUri, photoId);
      this.assertManagedPath(stored.relativePath);
      if (stored.mediaFormatVersion !== 1) {
        await this.driver.deleteEncryptedFile(stored.relativePath).catch(() => undefined);
        throw new Error('Unsupported encrypted media format');
      }
      return stored;
    } catch (error) {
      throw error;
    } finally {
      await Promise.all([
        this.driver.deleteTemporaryFile(capture.uri).catch(() => undefined),
        stagedUri
          ? this.driver.deleteTemporaryFile(stagedUri).catch(() => undefined)
          : Promise.resolve(),
      ]);
    }
  }

  async createDecryptedPreview(relativePath: string): Promise<DecryptedPreview> {
    this.assertManagedPath(relativePath);
    const uri = await this.driver.createPreview(
      relativePath,
      this.requireOpaqueId(this.nextOpaqueId()),
    );
    if (!uri.startsWith('content://')) throw new Error('Native preview reference is invalid');
    return { uri };
  }

  async deletePreview(previewUri: string): Promise<void> {
    if (!previewUri.startsWith('content://')) throw new Error('Preview reference is invalid');
    await this.driver.deletePreview(previewUri);
  }

  cleanupDecryptedCache(): Promise<void> {
    return this.driver.clearPreviewCache();
  }

  encryptionStatus(): Promise<MediaEncryptionStatus> {
    return this.driver.getMediaKeyStatus();
  }

  resolvePrivateUri(relativePath: string): never {
    this.assertManagedPath(relativePath);
    throw new Error(
      'Encrypted photo evidence has no direct file URI; request a short-lived preview instead',
    );
  }

  async deletePhoto(relativePath: string): Promise<void> {
    this.assertManagedPath(relativePath);
    await this.driver.deleteEncryptedFile(relativePath);
  }

  async clearAll(): Promise<void> {
    await this.driver.clearAllEncryptedMedia();
  }

  private assertManagedPath(relativePath: string): void {
    if (!SAFE_RELATIVE_PATH.test(relativePath) || relativePath.includes('..')) {
      throw new Error('Refusing to access a path outside encrypted media storage');
    }
  }

  private requireOpaqueId(value: string): string {
    if (!SAFE_OPAQUE_ID.test(value)) {
      throw new Error('Media identifier generator returned an unsafe identifier');
    }
    return value;
  }
}

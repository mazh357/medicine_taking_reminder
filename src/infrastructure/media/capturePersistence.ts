import { PhotoSaveError, type CameraCaptureResult, type PhotoSaveErrorCode } from './types';

type TakePicture = () => Promise<CameraCaptureResult | null | undefined>;
type CommitCapture = (localUri: string) => Promise<void>;

function containsStorageFull(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : error instanceof Error
        ? error.message
        : String(error);
  return /ENOSPC|no space left|SQLITE_FULL|database or disk is full/i.test(code);
}

/** Shared camera-to-domain boundary for both initial evidence and evidence retakes. */
export async function captureAndCommitPhoto(
  takePicture: TakePicture,
  commit: CommitCapture,
): Promise<void> {
  let capture: CameraCaptureResult | null | undefined;
  try {
    capture = await takePicture();
  } catch (error) {
    throw new PhotoSaveError('camera_unavailable', 'The camera could not capture a photo', {
      cause: error,
    });
  }
  if (!capture?.uri) {
    throw new PhotoSaveError('camera_result_missing', 'The camera returned no photo');
  }
  try {
    await commit(capture.uri);
  } catch (error) {
    if (error instanceof PhotoSaveError) throw error;
    if (containsStorageFull(error)) {
      throw new PhotoSaveError('storage_full', 'There is not enough space to save the photo', {
        cause: error,
      });
    }
    throw new PhotoSaveError('commit_failed', 'The photo record could not be committed', {
      cause: error,
    });
  }
}

export function photoSaveErrorMessage(error: unknown): string {
  const code: PhotoSaveErrorCode =
    error instanceof PhotoSaveError ? error.code : 'commit_failed';
  switch (code) {
    case 'camera_unavailable':
      return '相机暂时无法拍摄，请检查相机后重试。';
    case 'camera_result_missing':
      return '相机没有返回照片，请重新拍摄。';
    case 'unsupported_path':
      return '相机返回的照片路径不受支持，请重新拍摄。';
    case 'source_unreadable':
      return '刚拍摄的照片无法读取，请重新拍摄。';
    case 'storage_full':
      return '设备存储空间不足。清理空间后可重新拍摄。';
    case 'key_unavailable':
      return '照片加密密钥暂时不可用。现有数据未被清除，请稍后重试。';
    case 'encryption_failed':
      return '照片加密保存失败，请重新拍摄。';
    case 'commit_failed':
      return '照片记录未能保存。请重试，已有记录不会受到影响。';
  }
}

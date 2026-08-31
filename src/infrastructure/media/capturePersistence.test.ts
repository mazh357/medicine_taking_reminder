import { describe, expect, it, vi } from 'vitest';

import { captureAndCommitPhoto, photoSaveErrorMessage } from './capturePersistence';
import { PhotoSaveError } from './types';

describe('captureAndCommitPhoto', () => {
  it('shares one camera-to-commit boundary without changing the camera URI', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    await captureAndCommitPhoto(
      vi.fn().mockResolvedValue({ uri: 'file:///camera/result.jpg' }),
      commit,
    );
    expect(commit).toHaveBeenCalledWith('file:///camera/result.jpg');
  });

  it('distinguishes a missing camera result from a commit failure', async () => {
    await expect(
      captureAndCommitPhoto(vi.fn().mockResolvedValue(undefined), vi.fn()),
    ).rejects.toMatchObject({ code: 'camera_result_missing' });

    await expect(
      captureAndCommitPhoto(
        vi.fn().mockResolvedValue({ uri: 'file:///camera/result.jpg' }),
        vi.fn().mockRejectedValue(new Error('database rejected write')),
      ),
    ).rejects.toMatchObject({ code: 'commit_failed' });
  });

  it('preserves media failures and classifies full storage during commit', async () => {
    const keyFailure = new PhotoSaveError('key_unavailable', 'missing key');
    await expect(
      captureAndCommitPhoto(
        vi.fn().mockResolvedValue({ uri: 'file:///camera/result.jpg' }),
        vi.fn().mockRejectedValue(keyFailure),
      ),
    ).rejects.toBe(keyFailure);

    await expect(
      captureAndCommitPhoto(
        vi.fn().mockResolvedValue({ uri: 'file:///camera/result.jpg' }),
        vi.fn().mockRejectedValue(new Error('SQLITE_FULL: database or disk is full')),
      ),
    ).rejects.toMatchObject({ code: 'storage_full' });
  });

  it('provides recoverable user messages without exposing file paths', () => {
    expect(photoSaveErrorMessage(new PhotoSaveError('source_unreadable', 'D:/secret.jpg')))
      .toBe('刚拍摄的照片无法读取，请重新拍摄。');
    expect(photoSaveErrorMessage(new PhotoSaveError('key_unavailable', 'key alias')))
      .toContain('现有数据未被清除');
  });
});

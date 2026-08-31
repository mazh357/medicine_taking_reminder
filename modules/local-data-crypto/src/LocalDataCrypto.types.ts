export type MediaKeyStatus = {
  available: boolean;
  hardwareBacked: boolean | null;
  mediaFormatVersion: number;
};

export type EncryptedMediaResult = {
  relativePath: string;
  formatVersion: number;
};

export interface LocalDataCryptoNativeModule {
  encryptCameraFile(sourceUri: string, photoId: string): Promise<EncryptedMediaResult>;
  createPreview(relativePath: string, previewId: string): Promise<string>;
  deleteEncryptedFile(relativePath: string): Promise<void>;
  deletePreview(previewUri: string): Promise<void>;
  clearPreviewCache(): Promise<void>;
  clearAllEncryptedMedia(): Promise<void>;
  getMediaKeyStatus(): Promise<MediaKeyStatus>;
}

import { NativeModule, requireNativeModule } from 'expo';

import type { LocalDataCryptoNativeModule } from './LocalDataCrypto.types';

declare class LocalDataCryptoModule
  extends NativeModule
  implements LocalDataCryptoNativeModule
{
  encryptCameraFile: LocalDataCryptoNativeModule['encryptCameraFile'];
  createPreview: LocalDataCryptoNativeModule['createPreview'];
  deleteEncryptedFile: LocalDataCryptoNativeModule['deleteEncryptedFile'];
  deletePreview: LocalDataCryptoNativeModule['deletePreview'];
  clearPreviewCache: LocalDataCryptoNativeModule['clearPreviewCache'];
  clearAllEncryptedMedia: LocalDataCryptoNativeModule['clearAllEncryptedMedia'];
  getMediaKeyStatus: LocalDataCryptoNativeModule['getMediaKeyStatus'];
}

export default requireNativeModule<LocalDataCryptoModule>('LocalDataCrypto');

package expo.modules.localdatacrypto

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class LocalDataCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LocalDataCrypto")

    AsyncFunction("encryptCameraFile") Coroutine { sourceUri: String, photoId: String ->
      withContext(Dispatchers.IO) { crypto().encryptCameraFile(sourceUri, photoId) }
    }

    AsyncFunction("createPreview") Coroutine { relativePath: String, previewId: String ->
      withContext(Dispatchers.IO) { crypto().createPreview(relativePath, previewId) }
    }

    AsyncFunction("deleteEncryptedFile") Coroutine { relativePath: String ->
      withContext(Dispatchers.IO) { crypto().deleteEncryptedFile(relativePath) }
    }

    AsyncFunction("deletePreview") Coroutine { previewUri: String ->
      withContext(Dispatchers.IO) { crypto().deletePreview(previewUri) }
    }

    AsyncFunction("clearPreviewCache").SuspendBody<Unit> {
      withContext(Dispatchers.IO) { crypto().clearPreviewCache() }
    }

    AsyncFunction("clearAllEncryptedMedia").SuspendBody<Unit> {
      withContext(Dispatchers.IO) { crypto().clearAllEncryptedMedia() }
    }

    AsyncFunction("getMediaKeyStatus").SuspendBody<Map<String, Any?>> {
      withContext(Dispatchers.IO) { crypto().keyStatus() }
    }
  }

  private fun crypto(): SecureMediaCrypto {
    val context = appContext.reactContext
      ?: throw MediaCryptoException("ERR_MEDIA_CONTEXT", "Android context is unavailable")
    return SecureMediaCrypto(context)
  }
}

package expo.modules.localdatacrypto

import expo.modules.kotlin.exception.CodedException

internal class MediaCryptoException(
  code: String,
  safeMessage: String,
  cause: Throwable? = null
) : CodedException(code, safeMessage, cause)

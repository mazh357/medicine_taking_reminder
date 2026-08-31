package expo.modules.localdatacrypto

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException

internal object EncryptedMediaFormat {
  const val VERSION: Int = 1
  const val NONCE_SIZE: Int = 12
  const val TAG_BITS: Int = 128
  private val MAGIC = byteArrayOf(0x4d, 0x55, 0x41, 0x47) // MUAG
  private const val ALGORITHM_AES_GCM: Int = 1

  fun writeHeader(output: DataOutputStream, nonce: ByteArray): ByteArray {
    require(nonce.size == NONCE_SIZE) { "Invalid nonce length" }
    val header = MAGIC + byteArrayOf(VERSION.toByte(), ALGORITHM_AES_GCM.toByte(), NONCE_SIZE.toByte()) + nonce
    output.write(header)
    return header
  }

  fun readHeader(input: DataInputStream): Header {
    val fixed = ByteArray(MAGIC.size + 3)
    input.readFully(fixed)
    if (!fixed.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) {
      throw IOException("Encrypted media header is invalid")
    }
    val version = fixed[MAGIC.size].toInt() and 0xff
    val algorithm = fixed[MAGIC.size + 1].toInt() and 0xff
    val nonceSize = fixed[MAGIC.size + 2].toInt() and 0xff
    if (version != VERSION || algorithm != ALGORITHM_AES_GCM || nonceSize != NONCE_SIZE) {
      throw IOException("Encrypted media format is unsupported")
    }
    val nonce = ByteArray(nonceSize)
    input.readFully(nonce)
    return Header(fixed + nonce, nonce)
  }

  data class Header(val encoded: ByteArray, val nonce: ByteArray)
}

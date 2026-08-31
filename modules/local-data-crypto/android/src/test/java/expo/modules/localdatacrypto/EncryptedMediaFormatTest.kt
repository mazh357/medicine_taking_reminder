package expo.modules.localdatacrypto

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class EncryptedMediaFormatTest {
  @Test
  fun roundTripsHeaderWithoutKeyMaterial() {
    val nonce = ByteArray(EncryptedMediaFormat.NONCE_SIZE) { it.toByte() }
    val bytes = ByteArrayOutputStream()
    val encoded = EncryptedMediaFormat.writeHeader(DataOutputStream(bytes), nonce)
    val decoded = EncryptedMediaFormat.readHeader(
      DataInputStream(ByteArrayInputStream(bytes.toByteArray()))
    )
    assertArrayEquals(encoded, decoded.encoded)
    assertArrayEquals(nonce, decoded.nonce)
    assertEquals(19, encoded.size)
  }

  @Test(expected = IOException::class)
  fun rejectsUnknownHeader() {
    val invalid = ByteArray(19)
    EncryptedMediaFormat.readHeader(DataInputStream(ByteArrayInputStream(invalid)))
  }
}

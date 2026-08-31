package expo.modules.localdatacrypto

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.File
import java.io.FileInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureMediaCryptoInstrumentedTest {
  @Test
  fun encryptsAStagedCameraFileAndCreatesAPreview() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val photoId = "instrumentedphoto001"
    val previewId = "instrumentedpreview001"
    val original = ByteArray(4096) { index -> (index % 251).toByte() }
    val staging = File(context.cacheDir, "camera-staging").apply { mkdirs() }
    val source = File(staging, "$photoId.jpg").apply {
      writeBytes(original)
    }
    val crypto = SecureMediaCrypto(context)
    val relativePath = "encrypted-media/photos/$photoId.med1"
    runCatching { crypto.deleteEncryptedFile(relativePath) }

    var previewUri: String? = null
    try {
      val encrypted = crypto.encryptCameraFile(Uri.fromFile(source).toString(), photoId)
      assertEquals(relativePath, encrypted["relativePath"])
      assertEquals(1, encrypted["formatVersion"])
      assertFalse(source.exists())

      previewUri = crypto.createPreview(relativePath, previewId)
      assertEquals("content", Uri.parse(previewUri).scheme)
      val previewBytes = context.contentResolver.openInputStream(Uri.parse(previewUri))!!.use { it.readBytes() }
      assertArrayEquals(original, previewBytes)
      assertTrue(crypto.keyStatus()["available"] as Boolean)
      assertFalse(File(context.filesDir, "encrypted-media/photos/.$photoId.med1.tmp").exists())
    } finally {
      previewUri?.let { runCatching { crypto.deletePreview(it) } }
      runCatching { crypto.deleteEncryptedFile(relativePath) }
      source.delete()
    }
  }

  @Test
  fun keystoreGeneratesDifferentNoncesForTheSamePlaintext() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val crypto = SecureMediaCrypto(context)
    val staging = File(context.cacheDir, "camera-staging").apply { mkdirs() }
    val photoIds = listOf("instrumentednonce001", "instrumentednonce002")
    val plaintext = ByteArray(2048) { index -> (index % 199).toByte() }

    try {
      val nonces = photoIds.map { photoId ->
        val source = File(staging, "$photoId.jpg").apply { writeBytes(plaintext) }
        val result = crypto.encryptCameraFile(Uri.fromFile(source).toString(), photoId)
        val encrypted = File(context.filesDir, result["relativePath"] as String)
        DataInputStream(BufferedInputStream(FileInputStream(encrypted))).use {
          EncryptedMediaFormat.readHeader(it).nonce
        }
      }

      assertEquals(EncryptedMediaFormat.NONCE_SIZE, nonces[0].size)
      assertEquals(EncryptedMediaFormat.NONCE_SIZE, nonces[1].size)
      assertFalse(nonces[0].contentEquals(nonces[1]))
      assertNotEquals(
        File(context.filesDir, "encrypted-media/photos/${photoIds[0]}.med1").readBytes().toList(),
        File(context.filesDir, "encrypted-media/photos/${photoIds[1]}.med1").readBytes().toList()
      )
    } finally {
      photoIds.forEach { photoId ->
        runCatching { crypto.deleteEncryptedFile("encrypted-media/photos/$photoId.med1") }
        File(staging, "$photoId.jpg").delete()
      }
    }
  }

  @Test
  fun rejectsTamperedCiphertextWithoutProducingAPreview() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val crypto = SecureMediaCrypto(context)
    val photoId = "instrumentedtamper001"
    val previewId = "instrumentedtamperpreview001"
    val relativePath = "encrypted-media/photos/$photoId.med1"
    val staging = File(context.cacheDir, "camera-staging").apply { mkdirs() }
    val source = File(staging, "$photoId.jpg").apply { writeBytes(ByteArray(1024) { 0x5a.toByte() }) }

    try {
      crypto.encryptCameraFile(Uri.fromFile(source).toString(), photoId)
      val encrypted = File(context.filesDir, relativePath)
      val bytes = encrypted.readBytes()
      bytes[bytes.lastIndex] = (bytes.last().toInt() xor 0x01).toByte()
      encrypted.writeBytes(bytes)

      val error = assertThrows(MediaCryptoException::class.java) {
        crypto.createPreview(relativePath, previewId)
      }
      assertEquals("ERR_MEDIA_AUTHENTICATION", error.code)
      assertFalse(File(context.cacheDir, "decrypted-media").listFiles().orEmpty().any {
        it.name.startsWith("$previewId-")
      })
    } finally {
      runCatching { crypto.deleteEncryptedFile(relativePath) }
      source.delete()
    }
  }
}

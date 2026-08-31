package expo.modules.localdatacrypto

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import androidx.core.content.FileProvider
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyFactory
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class SecureMediaCrypto(private val context: Context) {
  private val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
  private val random = SecureRandom()
  private val encryptedRoot = File(context.filesDir, ENCRYPTED_ROOT)
  private val previewRoot = File(context.cacheDir, PREVIEW_ROOT)

  fun encryptCameraFile(sourceUri: String, photoId: String): Map<String, Any> {
    requireSafeId(photoId)
    val source = requireCameraCacheFile(sourceUri)
    val destination = requireManagedEncryptedFile("$ENCRYPTED_ROOT/$photoId.med1")
    val temporary = File(destination.parentFile, ".${destination.name}.tmp")
    destination.parentFile?.mkdirs()
    if (destination.exists()) throw MediaCryptoException("ERR_MEDIA_ALREADY_EXISTS", "Encrypted photo already exists")

    try {
      val cipher = Cipher.getInstance(TRANSFORMATION).apply {
        // Android Keystore rejects caller-provided IVs when randomized
        // encryption is required. Let Keystore generate the GCM IV, then
        // persist that IV alongside the ciphertext for later decryption.
        init(Cipher.ENCRYPT_MODE, getOrCreateKey())
      }
      val nonce = cipher.iv
      if (nonce == null || nonce.size != EncryptedMediaFormat.NONCE_SIZE) {
        throw MediaCryptoException("ERR_MEDIA_ENCRYPTION", "Photo encryption could not create a valid nonce")
      }
      FileInputStream(source).use { rawInput ->
        FileOutputStream(temporary).use { rawOutput ->
          val dataOutput = DataOutputStream(BufferedOutputStream(rawOutput))
          val header = EncryptedMediaFormat.writeHeader(dataOutput, nonce)
          cipher.updateAAD(header)
          val input = BufferedInputStream(rawInput)
          val buffer = ByteArray(COPY_BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            cipher.update(buffer, 0, read)?.let(dataOutput::write)
          }
          dataOutput.write(cipher.doFinal())
          dataOutput.flush()
          rawOutput.fd.sync()
        }
      }
      atomicMove(temporary, destination)
      return mapOf(
        "relativePath" to "$ENCRYPTED_ROOT/${destination.name}",
        "formatVersion" to EncryptedMediaFormat.VERSION
      )
    } catch (error: MediaCryptoException) {
      throw error
    } catch (error: FileNotFoundException) {
      throw MediaCryptoException("ERR_MEDIA_SOURCE_UNREADABLE", "Staged camera photo is unavailable", error)
    } catch (error: IOException) {
      if (isStorageFull(error)) {
        throw MediaCryptoException("ERR_MEDIA_STORAGE_FULL", "There is not enough storage for the encrypted photo", error)
      }
      throw MediaCryptoException("ERR_MEDIA_ENCRYPTION", "Photo encryption failed", error)
    } catch (error: Throwable) {
      throw MediaCryptoException("ERR_MEDIA_ENCRYPTION", "Photo encryption failed", error)
    } finally {
      temporary.delete()
      source.delete()
    }
  }

  fun createPreview(relativePath: String, previewId: String): String {
    requireSafeId(previewId)
    val source = requireManagedEncryptedFile(relativePath)
    if (!source.isFile) throw MediaCryptoException("ERR_MEDIA_NOT_FOUND", "Encrypted photo is unavailable")
    val key = getExistingKey()
      ?: throw MediaCryptoException("ERR_MEDIA_KEY_UNAVAILABLE", "Photo encryption key is unavailable")
    previewRoot.mkdirs()
    val destination = File(previewRoot, "$previewId-${randomFileToken()}.jpg")
    val temporary = File(previewRoot, ".${destination.name}.tmp")

    try {
      DataInputStream(BufferedInputStream(FileInputStream(source))).use { input ->
        val header = EncryptedMediaFormat.readHeader(input)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
          init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(EncryptedMediaFormat.TAG_BITS, header.nonce))
          updateAAD(header.encoded)
        }
        FileOutputStream(temporary).use { rawOutput ->
          val output = BufferedOutputStream(rawOutput)
          val buffer = ByteArray(COPY_BUFFER_SIZE)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            cipher.update(buffer, 0, read)?.let(output::write)
          }
          output.write(cipher.doFinal())
          output.flush()
          rawOutput.fd.sync()
        }
      }
      atomicMove(temporary, destination)
      return FileProvider.getUriForFile(
        context,
        "${context.packageName}.encryptedmedia",
        destination
      ).toString()
    } catch (_: AEADBadTagException) {
      throw MediaCryptoException("ERR_MEDIA_AUTHENTICATION", "Photo authentication failed")
    } catch (error: MediaCryptoException) {
      throw error
    } catch (error: Throwable) {
      val authenticationFailure = generateSequence(error) { it.cause }
        .any { it is AEADBadTagException }
      if (authenticationFailure) {
        throw MediaCryptoException("ERR_MEDIA_AUTHENTICATION", "Photo authentication failed")
      }
      throw MediaCryptoException("ERR_MEDIA_DECRYPTION", "Photo decryption failed")
    } finally {
      temporary.delete()
    }
  }

  fun deleteEncryptedFile(relativePath: String) {
    val encrypted = requireManagedEncryptedFile(relativePath)
    val photoId = encrypted.name.removeSuffix(".med1")
    if (encrypted.exists() && !encrypted.delete()) {
      throw MediaCryptoException("ERR_MEDIA_DELETE", "Encrypted photo could not be deleted")
    }
    deleteMatchingPreviews(photoId)
  }

  fun deletePreview(previewUri: String) {
    val uri = Uri.parse(previewUri)
    if (uri.scheme != "content" || uri.authority != "${context.packageName}.encryptedmedia") {
      throw MediaCryptoException("ERR_MEDIA_PATH", "Preview reference is invalid")
    }
    val name = uri.lastPathSegment?.substringAfterLast('/')
      ?: throw MediaCryptoException("ERR_MEDIA_PATH", "Preview reference is invalid")
    requireSafePreviewName(name)
    File(previewRoot, name).delete()
  }

  fun clearPreviewCache() {
    deleteDirectoryContents(previewRoot)
  }

  fun clearAllEncryptedMedia() {
    if (encryptedRoot.exists() && !encryptedRoot.deleteRecursively()) {
      throw MediaCryptoException("ERR_MEDIA_DELETE", "Encrypted media could not be cleared")
    }
    clearPreviewCache()
    if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
  }

  fun keyStatus(): Map<String, Any?> {
    val key = getExistingKey()
    val hardwareBacked = key?.let {
      runCatching {
        val keyFactory = KeyFactory.getInstance(it.algorithm, KEYSTORE_PROVIDER)
        val keyInfo = keyFactory.getKeySpec(it, KeyInfo::class.java)
        keyInfo.isInsideSecureHardware
      }.getOrNull()
    }
    return mapOf(
      "available" to (key != null),
      "hardwareBacked" to hardwareBacked,
      "mediaFormatVersion" to EncryptedMediaFormat.VERSION
    )
  }

  private fun getOrCreateKey(): SecretKey {
    getExistingKey()?.let { return it }
    if (encryptedRoot.listFiles()?.any { it.isFile && it.name.endsWith(".med1") } == true) {
      throw MediaCryptoException(
        "ERR_MEDIA_KEY_UNAVAILABLE",
        "Photo encryption key is unavailable; existing photos were not cleared"
      )
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  private fun getExistingKey(): SecretKey? =
    (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey

  private fun requireCameraCacheFile(uriText: String): File {
    val uri = Uri.parse(uriText)
    if (uri.scheme != "file") throw MediaCryptoException("ERR_MEDIA_PATH", "Camera file reference is invalid")
    val file = File(uri.path ?: "").canonicalFile
    val stagingRoot = File(context.cacheDir, CAMERA_STAGING_ROOT).canonicalFile
    if (!isAllowedCameraStagingFile(file, stagingRoot)) {
      throw MediaCryptoException("ERR_MEDIA_PATH", "Camera file reference is invalid")
    }
    return file
  }

  private fun requireManagedEncryptedFile(relativePath: String): File {
    if (!ENCRYPTED_PATH.matches(relativePath)) {
      throw MediaCryptoException("ERR_MEDIA_PATH", "Encrypted photo reference is invalid")
    }
    val file = File(context.filesDir, relativePath).canonicalFile
    val root = encryptedRoot.canonicalFile
    if (!file.path.startsWith(root.path + File.separator)) {
      throw MediaCryptoException("ERR_MEDIA_PATH", "Encrypted photo reference is invalid")
    }
    return file
  }

  private fun deleteMatchingPreviews(photoId: String) {
    previewRoot.listFiles()?.filter { it.name.startsWith("$photoId-") }?.forEach(File::delete)
  }

  private fun deleteDirectoryContents(directory: File) {
    directory.listFiles()?.forEach { it.deleteRecursively() }
  }

  private fun atomicMove(source: File, destination: File) {
    try {
      Files.move(source.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE)
    } catch (_: Throwable) {
      if (!source.renameTo(destination)) throw IOException("Atomic media commit failed")
    }
  }

  private fun isStorageFull(error: Throwable): Boolean =
    generateSequence(error) { it.cause }.any {
      val detail = "${it.message.orEmpty()} ${it.cause?.message.orEmpty()}"
      detail.contains("ENOSPC", ignoreCase = true) ||
        detail.contains("No space left", ignoreCase = true)
    }

  private fun randomFileToken(): String {
    val bytes = ByteArray(12).also(random::nextBytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  private fun requireSafeId(value: String) {
    if (!SAFE_ID.matches(value)) throw MediaCryptoException("ERR_MEDIA_ID", "Media identifier is invalid")
  }

  private fun requireSafePreviewName(value: String) {
    if (!SAFE_PREVIEW_NAME.matches(value)) {
      throw MediaCryptoException("ERR_MEDIA_PATH", "Preview reference is invalid")
    }
  }

  companion object {
    private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val KEY_ALIAS = "medication-app-media-aes-gcm-v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val ENCRYPTED_ROOT = "encrypted-media/photos"
    private const val PREVIEW_ROOT = "decrypted-media"
    private const val CAMERA_STAGING_ROOT = "camera-staging"
    private const val COPY_BUFFER_SIZE = 64 * 1024
    private val SAFE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$")
    private val ENCRYPTED_PATH = Regex("^encrypted-media/photos/[A-Za-z0-9][A-Za-z0-9_-]{7,79}\\.med1$")
    private val SAFE_PREVIEW_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{7,79}-[0-9a-f]{24}\\.jpg$")
  }
}

internal fun isAllowedCameraStagingFile(file: File, stagingRoot: File): Boolean {
  val canonicalFile = file.canonicalFile
  val canonicalRoot = stagingRoot.canonicalFile
  return canonicalFile.path.startsWith(canonicalRoot.path + File.separator) && canonicalFile.isFile
}

package expo.modules.localdatacrypto

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CameraStagingPathTest {
  @Test
  fun acceptsOnlyFilesInsideTheDedicatedStagingDirectory() {
    val cache = Files.createTempDirectory("media-cache").toFile()
    try {
      val staging = File(cache, "camera-staging").apply { mkdirs() }
      val inside = File(staging, "opaque123.jpg").apply { writeBytes(byteArrayOf(1)) }
      val outside = File(cache, "camera-result.jpg").apply { writeBytes(byteArrayOf(1)) }

      assertTrue(isAllowedCameraStagingFile(inside, staging))
      assertFalse(isAllowedCameraStagingFile(outside, staging))
      assertFalse(isAllowedCameraStagingFile(File(staging, "missing.jpg"), staging))
    } finally {
      cache.deleteRecursively()
    }
  }
}

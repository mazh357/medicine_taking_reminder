package expo.modules.demopillcounter

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.io.InputStream

internal data class DecodedImage(
  val frame: PixelFrame,
  val sourceWidth: Int,
  val sourceHeight: Int
)

/** Reads only local file/content URIs and bounds memory before decoding. */
internal class SafeImageDecoder(private val context: Context) {
  fun decode(uriString: String): DecodedImage {
    val uri = Uri.parse(uriString)
    require(uri.scheme == "file" || uri.scheme == "content") { "Only local image URIs are supported" }
    validateFileUri(uri)

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(uri).use { input -> BitmapFactory.decodeStream(input, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "Image dimensions are invalid" }
    require(bounds.outWidth <= MAX_SOURCE_EDGE && bounds.outHeight <= MAX_SOURCE_EDGE) {
      "Image dimensions exceed the safety limit"
    }
    require(bounds.outWidth.toLong() * bounds.outHeight <= MAX_SOURCE_PIXELS) {
      "Image pixel count exceeds the safety limit"
    }

    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
      inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888
    }
    val bitmap = open(uri).use { input ->
      requireNotNull(BitmapFactory.decodeStream(input, null, options)) { "Unable to decode image" }
    }
    try {
      val pixels = IntArray(bitmap.width * bitmap.height)
      bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
      return DecodedImage(
        frame = PixelFrame(bitmap.width, bitmap.height, pixels),
        sourceWidth = bounds.outWidth,
        sourceHeight = bounds.outHeight
      )
    } finally {
      bitmap.recycle()
    }
  }

  private fun validateFileUri(uri: Uri) {
    if (uri.scheme != "file") return
    val path = requireNotNull(uri.path) { "File URI has no path" }
    val requested = File(path).canonicalFile
    val privateRoot = File(context.applicationInfo.dataDir).canonicalFile
    require(requested.path == privateRoot.path || requested.path.startsWith(privateRoot.path + File.separator)) {
      "File URI is outside the application-private directory"
    }
  }

  private fun open(uri: Uri): InputStream = requireNotNull(context.contentResolver.openInputStream(uri)) {
    "Unable to open image URI"
  }

  private fun sampleSize(width: Int, height: Int): Int {
    var sample = 1
    while (maxOf(width, height) / sample > CounterThresholds.MAX_DECODED_EDGE) {
      sample *= 2
    }
    return sample
  }

  private companion object {
    const val MAX_SOURCE_EDGE = 20_000
    const val MAX_SOURCE_PIXELS = 60_000_000L
  }
}

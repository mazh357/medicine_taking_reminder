package expo.modules.demopillcounter

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

/**
 * Counts separated foreground objects on a controlled, plain background.
 *
 * This module intentionally has no concept of medication identity, dose, regimen, or
 * consumption. Every failure is converted to the TypeScript contract's safe manual fallback.
 */
class DemoPillCounterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DemoPillCounter")

    AsyncFunction("countObjects") Coroutine { photoUri: String ->
      withContext(Dispatchers.IO) {
        try {
          val context = requireNotNull(appContext.reactContext) { "Android context is unavailable" }
          val decoded = SafeImageDecoder(context).decode(photoUri)
          when (val result = ControlledBackgroundCounter().count(decoded.frame)) {
            is CounterResult.Counted -> countedMap(result, decoded)
            is CounterResult.Unable -> unableMap(result.reason.wireValue)
          }
        } catch (_: Throwable) {
          unableMap("processing_error")
        }
      }
    }
  }

  private fun countedMap(
    result: CounterResult.Counted,
    decoded: DecodedImage
  ): Map<String, Any> {
    val scaleX = decoded.sourceWidth.toDouble() / decoded.frame.width
    val scaleY = decoded.sourceHeight.toDouble() / decoded.frame.height
    val boxes = result.boxes.map { box ->
      mapOf(
        "x" to (box.x * scaleX).roundToInt(),
        "y" to (box.y * scaleY).roundToInt(),
        "width" to (box.width * scaleX).roundToInt().coerceAtLeast(1),
        "height" to (box.height * scaleY).roundToInt().coerceAtLeast(1)
      )
    }

    return mapOf(
      "status" to "counted",
      "detectedObjectCount" to result.boxes.size,
      "quality" to "acceptable",
      "boxes" to boxes
    )
  }

  private fun unableMap(reason: String): Map<String, Any> = mapOf(
    "status" to "unable",
    "reason" to reason
  )
}

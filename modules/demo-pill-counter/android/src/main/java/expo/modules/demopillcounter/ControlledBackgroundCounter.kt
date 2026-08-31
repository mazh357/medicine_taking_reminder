package expo.modules.demopillcounter

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

internal object CounterThresholds {
  const val ALGORITHM_VERSION = "controlled-contour-v0.1"
  const val MAX_DECODED_EDGE = 1024
  const val EDGE_BAND_FRACTION = 0.04
  const val MAX_BACKGROUND_RMS_DISTANCE = 24.0
  const val MIN_FOREGROUND_DISTANCE = 30.0
  const val BACKGROUND_RMS_MULTIPLIER = 2.8
  const val BACKGROUND_DISTANCE_OFFSET = 10.0
  const val MIN_FOREGROUND_FRACTION = 0.0008
  const val MAX_FOREGROUND_FRACTION = 0.48
  const val MIN_COMPONENT_FRACTION = 0.00035
  const val MAX_COMPONENT_FRACTION = 0.20
  const val MAX_COMPONENT_ASPECT_RATIO = 4.2
  const val MAX_COMPONENT_COUNT = 20
  const val MAX_SMALL_NOISE_COMPONENTS = 80
  const val MIN_BOUNDARY_GRADIENT = 7.0
  const val TOO_DARK_MEAN_LUMA = 10.0
  const val TOO_DARK_P90_LUMA = 24
  const val OVERLAP_AREA_MULTIPLIER = 1.65
}

internal data class PixelFrame(val width: Int, val height: Int, val pixels: IntArray) {
  init {
    require(width > 0 && height > 0)
    require(pixels.size == width * height)
  }
}

internal data class PixelBox(val x: Int, val y: Int, val width: Int, val height: Int)

internal enum class UnableReason(val wireValue: String) {
  LOW_CONTRAST("low_contrast"),
  BLUR("blur"),
  OVERLAP("overlap"),
  BACKGROUND_NOISE("background_noise"),
  TOO_DARK("too_dark")
}

internal sealed interface CounterResult {
  data class Counted(val boxes: List<PixelBox>) : CounterResult
  data class Unable(val reason: UnableReason) : CounterResult
}

/** Pure pixel algorithm; it deliberately has no Android, medicine, or dose dependency. */
internal class ControlledBackgroundCounter {
  fun count(frame: PixelFrame): CounterResult {
    if (isTooDark(frame)) return CounterResult.Unable(UnableReason.TOO_DARK)

    val background = estimateBackground(frame)
    if (background.rmsDistance > CounterThresholds.MAX_BACKGROUND_RMS_DISTANCE) {
      return CounterResult.Unable(UnableReason.BACKGROUND_NOISE)
    }

    val threshold = max(
      CounterThresholds.MIN_FOREGROUND_DISTANCE,
      background.rmsDistance * CounterThresholds.BACKGROUND_RMS_MULTIPLIER +
        CounterThresholds.BACKGROUND_DISTANCE_OFFSET
    )
    val rawMask = foregroundMask(frame, background, threshold)
    val rawFraction = rawMask.count { it }.toDouble() / rawMask.size
    if (rawFraction < CounterThresholds.MIN_FOREGROUND_FRACTION) {
      return CounterResult.Unable(UnableReason.LOW_CONTRAST)
    }
    if (rawFraction > CounterThresholds.MAX_FOREGROUND_FRACTION) {
      return CounterResult.Unable(UnableReason.BACKGROUND_NOISE)
    }
    if (boundaryGradient(frame, rawMask) < CounterThresholds.MIN_BOUNDARY_GRADIENT) {
      return CounterResult.Unable(UnableReason.BLUR)
    }

    val cleaned = close(open(rawMask, frame.width, frame.height), frame.width, frame.height)
    val labeling = connectedComponents(cleaned, frame.width, frame.height)
    val minArea = max(24, (cleaned.size * CounterThresholds.MIN_COMPONENT_FRACTION).roundToInt())
    val maxArea = (cleaned.size * CounterThresholds.MAX_COMPONENT_FRACTION).roundToInt()
    val meaningful = labeling.components.filter { it.area >= minArea }
    val ignoredNoise = labeling.components.count { it.area in 2 until minArea }

    if (ignoredNoise > CounterThresholds.MAX_SMALL_NOISE_COMPONENTS) {
      return CounterResult.Unable(UnableReason.BACKGROUND_NOISE)
    }
    if (meaningful.isEmpty()) return CounterResult.Unable(UnableReason.LOW_CONTRAST)
    if (meaningful.size > CounterThresholds.MAX_COMPONENT_COUNT) {
      return CounterResult.Unable(UnableReason.BACKGROUND_NOISE)
    }
    if (meaningful.any { it.touchesBoundary }) {
      return CounterResult.Unable(UnableReason.BACKGROUND_NOISE)
    }
    if (meaningful.any { it.area > maxArea || it.aspectRatio > CounterThresholds.MAX_COMPONENT_ASPECT_RATIO }) {
      return CounterResult.Unable(UnableReason.OVERLAP)
    }
    if (meaningful.any { hasStrongNeck(labeling.labels, frame.width, it) }) {
      return CounterResult.Unable(UnableReason.OVERLAP)
    }
    if (hasOversizedComponent(meaningful)) {
      return CounterResult.Unable(UnableReason.OVERLAP)
    }

    return CounterResult.Counted(
      meaningful.sortedWith(compareBy<Component> { it.minY }.thenBy { it.minX }).map { it.box }
    )
  }

  private data class Background(val red: Int, val green: Int, val blue: Int, val rmsDistance: Double)

  private fun estimateBackground(frame: PixelFrame): Background {
    val band = max(2, (min(frame.width, frame.height) * CounterThresholds.EDGE_BAND_FRACTION).roundToInt())
    val redHistogram = IntArray(256)
    val greenHistogram = IntArray(256)
    val blueHistogram = IntArray(256)
    var samples = 0

    for (y in 0 until frame.height) {
      for (x in 0 until frame.width) {
        if (x >= band && x < frame.width - band && y >= band && y < frame.height - band) continue
        val color = frame.pixels[y * frame.width + x]
        redHistogram[red(color)]++
        greenHistogram[green(color)]++
        blueHistogram[blue(color)]++
        samples++
      }
    }
    val bgRed = median(redHistogram, samples)
    val bgGreen = median(greenHistogram, samples)
    val bgBlue = median(blueHistogram, samples)
    var sumSquaredDistance = 0.0
    for (y in 0 until frame.height) {
      for (x in 0 until frame.width) {
        if (x >= band && x < frame.width - band && y >= band && y < frame.height - band) continue
        sumSquaredDistance += colorDistanceSquared(frame.pixels[y * frame.width + x], bgRed, bgGreen, bgBlue)
      }
    }
    return Background(bgRed, bgGreen, bgBlue, sqrt(sumSquaredDistance / samples))
  }

  private fun foregroundMask(frame: PixelFrame, background: Background, threshold: Double): BooleanArray {
    val thresholdSquared = threshold * threshold
    return BooleanArray(frame.pixels.size) { index ->
      colorDistanceSquared(frame.pixels[index], background.red, background.green, background.blue) >= thresholdSquared
    }
  }

  private fun isTooDark(frame: PixelFrame): Boolean {
    val histogram = IntArray(256)
    var sum = 0L
    frame.pixels.forEach { color ->
      val value = luma(color)
      histogram[value]++
      sum += value
    }
    val mean = sum.toDouble() / frame.pixels.size
    return mean < CounterThresholds.TOO_DARK_MEAN_LUMA &&
      percentile(histogram, frame.pixels.size, 0.90) < CounterThresholds.TOO_DARK_P90_LUMA
  }

  private fun boundaryGradient(frame: PixelFrame, mask: BooleanArray): Double {
    var total = 0.0
    var samples = 0
    val directions = intArrayOf(-1, 0, 1, 0, -1)
    for (y in 1 until frame.height - 1) {
      for (x in 1 until frame.width - 1) {
        val index = y * frame.width + x
        if (!mask[index]) continue
        for (d in 0 until 4) {
          val neighborIndex = (y + directions[d + 1]) * frame.width + x + directions[d]
          if (!mask[neighborIndex]) {
            total += colorDistance(frame.pixels[index], frame.pixels[neighborIndex])
            samples++
          }
        }
      }
    }
    return if (samples == 0) 0.0 else total / samples
  }

  private fun open(mask: BooleanArray, width: Int, height: Int): BooleanArray =
    dilate(erode(mask, width, height), width, height)

  private fun close(mask: BooleanArray, width: Int, height: Int): BooleanArray =
    erode(dilate(mask, width, height), width, height)

  private fun erode(mask: BooleanArray, width: Int, height: Int): BooleanArray {
    val output = BooleanArray(mask.size)
    for (y in 1 until height - 1) {
      for (x in 1 until width - 1) {
        var keep = true
        loop@ for (dy in -1..1) {
          for (dx in -1..1) {
            if (!mask[(y + dy) * width + x + dx]) {
              keep = false
              break@loop
            }
          }
        }
        output[y * width + x] = keep
      }
    }
    return output
  }

  private fun dilate(mask: BooleanArray, width: Int, height: Int): BooleanArray {
    val output = BooleanArray(mask.size)
    for (y in 1 until height - 1) {
      for (x in 1 until width - 1) {
        var present = false
        loop@ for (dy in -1..1) {
          for (dx in -1..1) {
            if (mask[(y + dy) * width + x + dx]) {
              present = true
              break@loop
            }
          }
        }
        output[y * width + x] = present
      }
    }
    return output
  }

  private data class Component(
    val label: Int,
    val area: Int,
    val minX: Int,
    val minY: Int,
    val maxX: Int,
    val maxY: Int,
    val touchesBoundary: Boolean
  ) {
    val box: PixelBox get() = PixelBox(minX, minY, maxX - minX + 1, maxY - minY + 1)
    val aspectRatio: Double
      get() = max(box.width, box.height).toDouble() / min(box.width, box.height).coerceAtLeast(1)
  }

  private data class Labeling(val labels: IntArray, val components: List<Component>)

  private fun connectedComponents(mask: BooleanArray, width: Int, height: Int): Labeling {
    val labels = IntArray(mask.size)
    val queue = IntArray(mask.size)
    val components = mutableListOf<Component>()
    var nextLabel = 1
    val directions = intArrayOf(-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1)

    for (start in mask.indices) {
      if (!mask[start] || labels[start] != 0) continue
      var head = 0
      var tail = 0
      queue[tail++] = start
      labels[start] = nextLabel
      var area = 0
      var minX = width
      var minY = height
      var maxX = 0
      var maxY = 0
      var boundary = false

      while (head < tail) {
        val index = queue[head++]
        val x = index % width
        val y = index / width
        area++
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x)
        maxY = max(maxY, y)
        boundary = boundary || x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2
        for (d in directions.indices step 2) {
          val nx = x + directions[d]
          val ny = y + directions[d + 1]
          if (nx !in 0 until width || ny !in 0 until height) continue
          val neighbor = ny * width + nx
          if (mask[neighbor] && labels[neighbor] == 0) {
            labels[neighbor] = nextLabel
            queue[tail++] = neighbor
          }
        }
      }
      components += Component(nextLabel, area, minX, minY, maxX, maxY, boundary)
      nextLabel++
    }
    return Labeling(labels, components)
  }

  private fun hasStrongNeck(labels: IntArray, width: Int, component: Component): Boolean {
    val columns = IntArray(component.box.width)
    val rows = IntArray(component.box.height)
    for (y in component.minY..component.maxY) {
      for (x in component.minX..component.maxX) {
        if (labels[y * width + x] == component.label) {
          columns[x - component.minX]++
          rows[y - component.minY]++
        }
      }
    }
    return hasTwoLobes(columns) || hasTwoLobes(rows)
  }

  private fun hasTwoLobes(profile: IntArray): Boolean {
    if (profile.size < 12) return false
    val from = max(2, profile.size / 5)
    val to = min(profile.lastIndex - 2, profile.lastIndex * 4 / 5)
    for (valleyIndex in from..to) {
      val leftPeak = profile.copyOfRange(0, valleyIndex).maxOrNull() ?: 0
      val rightPeak = profile.copyOfRange(valleyIndex + 1, profile.size).maxOrNull() ?: 0
      val smallerPeak = min(leftPeak, rightPeak)
      if (smallerPeak >= 5 && profile[valleyIndex] * 2 < smallerPeak) return true
    }
    return false
  }

  private fun hasOversizedComponent(components: List<Component>): Boolean {
    if (components.size < 3) return false
    val sortedAreas = components.map { it.area }.sorted()
    val median = sortedAreas[sortedAreas.size / 2].toDouble()
    return sortedAreas.last() > median * CounterThresholds.OVERLAP_AREA_MULTIPLIER
  }

  private fun median(histogram: IntArray, total: Int): Int = percentile(histogram, total, 0.50)

  private fun percentile(histogram: IntArray, total: Int, percentile: Double): Int {
    val target = (total * percentile).roundToInt().coerceAtLeast(1)
    var seen = 0
    for (value in histogram.indices) {
      seen += histogram[value]
      if (seen >= target) return value
    }
    return histogram.lastIndex
  }

  private fun colorDistanceSquared(
    color: Int,
    backgroundRed: Int,
    backgroundGreen: Int,
    backgroundBlue: Int
  ): Double {
    val dr = red(color) - backgroundRed
    val dg = green(color) - backgroundGreen
    val db = blue(color) - backgroundBlue
    return (dr * dr + dg * dg + db * db) / 3.0
  }

  private fun colorDistance(first: Int, second: Int): Double =
    sqrt(colorDistanceSquared(first, red(second), green(second), blue(second)))

  private fun red(color: Int): Int = color ushr 16 and 0xff
  private fun green(color: Int): Int = color ushr 8 and 0xff
  private fun blue(color: Int): Int = color and 0xff
  private fun luma(color: Int): Int =
    (0.2126 * red(color) + 0.7152 * green(color) + 0.0722 * blue(color)).roundToInt()
}

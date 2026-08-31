package expo.modules.demopillcounter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ControlledBackgroundCounterTest {
  private val counter = ControlledBackgroundCounter()

  @Test
  fun countsSeparatedSyntheticObjects() {
    val image = SyntheticFrame(320, 240, rgb(235, 235, 235))
      .circle(70, 70, 20, rgb(35, 80, 160))
      .circle(160, 120, 24, rgb(170, 45, 50))
      .ellipse(250, 175, 30, 15, rgb(40, 130, 65))
      .build()

    val result = counter.count(image)

    assertTrue(result is CounterResult.Counted)
    assertEquals(3, (result as CounterResult.Counted).boxes.size)
  }

  @Test
  fun acceptsBrightObjectsOnDarkControlledBackground() {
    val image = SyntheticFrame(240, 200, rgb(28, 28, 30))
      .circle(70, 90, 22, rgb(225, 225, 215))
      .ellipse(165, 110, 28, 14, rgb(220, 170, 55))
      .build()

    val result = counter.count(image)

    assertTrue(result is CounterResult.Counted)
    assertEquals(2, (result as CounterResult.Counted).boxes.size)
  }

  @Test
  fun rejectsNearBackgroundObjectsAsLowContrast() {
    val image = SyntheticFrame(240, 200, rgb(210, 210, 210))
      .circle(120, 100, 30, rgb(202, 205, 207))
      .build()

    assertEquals(CounterResult.Unable(UnableReason.LOW_CONTRAST), counter.count(image))
  }

  @Test
  fun rejectsVeryDarkImage() {
    val image = SyntheticFrame(200, 160, rgb(3, 3, 3))
      .circle(100, 80, 24, rgb(12, 12, 12))
      .build()

    assertEquals(CounterResult.Unable(UnableReason.TOO_DARK), counter.count(image))
  }

  @Test
  fun rejectsNoisyBorder() {
    val builder = SyntheticFrame(240, 200, rgb(225, 225, 225))
      .circle(120, 100, 24, rgb(40, 80, 150))
    builder.checkeredBorder(14, rgb(80, 80, 80), rgb(245, 245, 245))

    assertEquals(CounterResult.Unable(UnableReason.BACKGROUND_NOISE), counter.count(builder.build()))
  }

  @Test
  fun rejectsSyntheticSoftEdgeAsBlur() {
    val image = SyntheticFrame(220, 180, rgb(220, 220, 220))
      .softGrayCircle(110, 90, 32, 92)
      .build()

    assertEquals(CounterResult.Unable(UnableReason.BLUR), counter.count(image))
  }

  @Test
  fun rejectsObviousConnectedDoubleLobe() {
    val image = SyntheticFrame(260, 180, rgb(235, 235, 235))
      .circle(85, 90, 26, rgb(40, 70, 145))
      .circle(175, 90, 26, rgb(40, 70, 145))
      .rectangle(111, 87, 149, 93, rgb(40, 70, 145))
      .build()

    assertEquals(CounterResult.Unable(UnableReason.OVERLAP), counter.count(image))
  }

  private class SyntheticFrame(
    private val width: Int,
    private val height: Int,
    background: Int
  ) {
    private val pixels = IntArray(width * height) { background }

    fun circle(cx: Int, cy: Int, radius: Int, color: Int): SyntheticFrame =
      ellipse(cx, cy, radius, radius, color)

    fun ellipse(cx: Int, cy: Int, radiusX: Int, radiusY: Int, color: Int): SyntheticFrame {
      for (y in (cy - radiusY).coerceAtLeast(0)..(cy + radiusY).coerceAtMost(height - 1)) {
        for (x in (cx - radiusX).coerceAtLeast(0)..(cx + radiusX).coerceAtMost(width - 1)) {
          val dx = (x - cx).toDouble() / radiusX
          val dy = (y - cy).toDouble() / radiusY
          if (dx * dx + dy * dy <= 1.0) pixels[y * width + x] = color
        }
      }
      return this
    }

    fun rectangle(left: Int, top: Int, right: Int, bottom: Int, color: Int): SyntheticFrame {
      for (y in top.coerceAtLeast(0)..bottom.coerceAtMost(height - 1)) {
        for (x in left.coerceAtLeast(0)..right.coerceAtMost(width - 1)) {
          pixels[y * width + x] = color
        }
      }
      return this
    }

    fun softGrayCircle(cx: Int, cy: Int, radius: Int, centerLuma: Int): SyntheticFrame {
      for (y in (cy - radius).coerceAtLeast(0)..(cy + radius).coerceAtMost(height - 1)) {
        for (x in (cx - radius).coerceAtLeast(0)..(cx + radius).coerceAtMost(width - 1)) {
          val distance = kotlin.math.sqrt(((x - cx) * (x - cx) + (y - cy) * (y - cy)).toDouble())
          if (distance <= radius) {
            val blend = distance / radius
            val luma = (centerLuma + (220 - centerLuma) * blend).toInt()
            pixels[y * width + x] = rgb(luma, luma, luma)
          }
        }
      }
      return this
    }

    fun checkeredBorder(size: Int, first: Int, second: Int): SyntheticFrame {
      for (y in 0 until height) {
        for (x in 0 until width) {
          if (x < size || y < size || x >= width - size || y >= height - size) {
            pixels[y * width + x] = if ((x / 4 + y / 4) % 2 == 0) first else second
          }
        }
      }
      return this
    }

    fun build(): PixelFrame = PixelFrame(width, height, pixels.copyOf())
  }

  private companion object {
    fun rgb(red: Int, green: Int, blue: Int): Int =
      (0xff shl 24) or (red shl 16) or (green shl 8) or blue
  }
}

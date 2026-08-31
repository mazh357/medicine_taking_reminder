# DemoPillCounter

Android-only local Expo Module for the internal, fictional-data Demo. It counts separated
foreground objects on a controlled plain background. It does not identify medicine, infer dose,
map objects to medication items, or confirm consumption.

## Algorithm boundary

- accepts only `file://` (inside app-private storage) or `content://` URIs;
- bounds source images to 20,000 pixels per edge / 60 MP and decodes to at most about 1024 pixels
  on the longest edge;
- estimates background colour and variance from a 4% edge band;
- segments by RGB distance, applies a 3x3 opening and closing, then labels connected regions;
- rejects low contrast, darkness, noisy backgrounds, boundary contact, implausible aspect/area,
  or obvious connected/oversized shapes;
- maps every unexpected native exception to `unable / processing_error` so manual entry remains
  available.

The TypeScript infrastructure adapter applies a fixed 3-second default timeout (configurable for
tests and device calibration). A timeout is only an unavailable observation and cannot create a
consumption assertion or inventory movement. Short-lived decrypted media may be supplied as an
app-private `file://` URI or a permission-bearing `content://` URI; filenames and extensions are
never interpreted.

Thresholds are versioned in `CounterThresholds` as `controlled-contour-v0.1`. Tests use only
synthetic geometric images and never real medicine or patient data.

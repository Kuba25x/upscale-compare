package io.github.kuba25x.upscalecompare;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.util.Base64;
import androidx.exifinterface.media.ExifInterface;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;

final class OriginalThumbnail {
  static final int MAX_EDGE = 128;
  private static final int MAX_PNG_BYTES = 72 * 1024;

  private OriginalThumbnail() {}

  static int sampleSize(int longestEdge) {
    int sample = 1;
    // BitmapFactory rounds inSampleSize down to a power of two. Keep the sampled bitmap
    // within 256 x 256 before scaling, even for UHD originals.
    while (longestEdge > 2 * MAX_EDGE * sample) sample *= 2;
    return sample;
  }

  static String create(File file) throws IOException {
    String path = file.getPath();
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(path, options);
    OriginalPolicy.dimensions(options.outWidth, options.outHeight);
    options.inSampleSize = sampleSize(Math.max(options.outWidth, options.outHeight));
    options.inJustDecodeBounds = false;
    options.inPreferredConfig = Bitmap.Config.ARGB_8888;
    options.inScaled = false;

    Bitmap sampled = BitmapFactory.decodeFile(path, options);
    if (sampled == null) return null;
    Bitmap scaled = sampled;
    Bitmap oriented = sampled;
    try {
      int width = sampled.getWidth();
      int height = sampled.getHeight();
      int edge = Math.max(width, height);
      if (edge > MAX_EDGE) {
        int scaledWidth = Math.max(1, Math.round(width * (float) MAX_EDGE / edge));
        int scaledHeight = Math.max(1, Math.round(height * (float) MAX_EDGE / edge));
        scaled = Bitmap.createScaledBitmap(sampled, scaledWidth, scaledHeight, true);
      }
      ExifInterface exif = new ExifInterface(path);
      Matrix transform = new Matrix();
      if (exif.isFlipped()) transform.setScale(-1, 1);
      transform.postRotate(exif.getRotationDegrees());
      oriented =
          Bitmap.createBitmap(scaled, 0, 0, scaled.getWidth(), scaled.getHeight(), transform, true);

      ByteArrayOutputStream png = new ByteArrayOutputStream();
      if (!oriented.compress(Bitmap.CompressFormat.PNG, 100, png) || png.size() > MAX_PNG_BYTES)
        return null;
      return "data:image/png;base64," + Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP);
    } finally {
      if (oriented != scaled && oriented != sampled) oriented.recycle();
      if (scaled != sampled) scaled.recycle();
      sampled.recycle();
    }
  }
}

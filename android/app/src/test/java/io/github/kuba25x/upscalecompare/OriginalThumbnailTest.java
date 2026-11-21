package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;
import androidx.exifinterface.media.ExifInterface;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import javax.imageio.ImageIO;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class OriginalThumbnailTest {
  @Rule public TemporaryFolder folder = new TemporaryFolder();

  private Bitmap thumbnail(File file) throws Exception {
    String dataUrl = OriginalThumbnail.create(file);
    assertNotNull(dataUrl);
    String prefix = "data:image/png;base64,";
    assertTrue(dataUrl.startsWith(prefix));
    byte[] png = Base64.decode(dataUrl.substring(prefix.length()), Base64.DEFAULT);
    assertTrue(png.length <= 72 * 1024);
    Bitmap thumbnail = BitmapFactory.decodeByteArray(png, 0, png.length);
    assertNotNull(thumbnail);
    assertTrue(thumbnail.getWidth() <= 128 && thumbnail.getHeight() <= 128);
    return thumbnail;
  }

  @Test
  public void largePngsAreSampledBeforeScalingWithoutChangingTheSource() throws Exception {
    for (int width : new int[] {3840, 7680}) {
      int height = width * 9 / 16;
      File original = folder.newFile();
      // Generate a compressible UHD input without asking Android to allocate a full-size bitmap.
      BufferedImage fixture = new BufferedImage(width, height, BufferedImage.TYPE_BYTE_GRAY);
      assertTrue(ImageIO.write(fixture, "png", original));
      byte[] before = Files.readAllBytes(original.toPath());
      int sample = OriginalThumbnail.sampleSize(width);
      assertTrue(sample > 1 && (width + sample - 1) / sample <= 256);
      Bitmap preview = thumbnail(original);
      assertEquals(128, preview.getWidth());
      assertEquals(72, preview.getHeight());
      preview.recycle();
      assertArrayEquals(before, Files.readAllBytes(original.toPath()));
    }
  }

  @Test
  public void jpegPreviewAppliesExifRotationAndMirroring() throws Exception {
    File original = folder.newFile();
    Bitmap source = Bitmap.createBitmap(60, 40, Bitmap.Config.ARGB_8888);
    source.eraseColor(Color.RED);
    for (int x = 30; x < 60; x++) {
      for (int y = 0; y < 40; y++) source.setPixel(x, y, Color.BLUE);
    }
    try (FileOutputStream out = new FileOutputStream(original)) {
      assertTrue(source.compress(Bitmap.CompressFormat.JPEG, 95, out));
    }
    source.recycle();
    ExifInterface exif = new ExifInterface(original);
    exif.setAttribute(ExifInterface.TAG_ORIENTATION, "7");
    exif.saveAttributes();
    byte[] before = Files.readAllBytes(original.toPath());
    Bitmap preview = thumbnail(original);
    assertEquals(40, preview.getWidth());
    assertEquals(60, preview.getHeight());
    assertTrue(Color.blue(preview.getPixel(20, 8)) > 240);
    assertTrue(Color.red(preview.getPixel(20, 52)) > 240);
    preview.recycle();
    assertArrayEquals(before, Files.readAllBytes(original.toPath()));
  }

  @Test
  public void staticWebpPreviewPreservesAlpha() throws Exception {
    File original = folder.newFile();
    Bitmap source = Bitmap.createBitmap(256, 128, Bitmap.Config.ARGB_8888);
    source.setPixel(10, 10, Color.BLUE);
    try (FileOutputStream out = new FileOutputStream(original)) {
      assertTrue(source.compress(Bitmap.CompressFormat.WEBP_LOSSLESS, 100, out));
    }
    source.recycle();
    byte[] before = Files.readAllBytes(original.toPath());
    Bitmap preview = thumbnail(original);
    assertEquals(128, preview.getWidth());
    assertEquals(64, preview.getHeight());
    assertEquals(0, Color.alpha(preview.getPixel(0, 0)));
    preview.recycle();
    assertArrayEquals(before, Files.readAllBytes(original.toPath()));
  }

  @Test
  public void invalidImageCannotProduceATinyPreview() throws Exception {
    File original = folder.newFile();
    assertThrows(IOException.class, () -> OriginalThumbnail.create(original));
  }
}

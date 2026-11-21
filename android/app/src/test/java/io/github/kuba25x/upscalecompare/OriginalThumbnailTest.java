package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;
import androidx.exifinterface.media.ExifInterface;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.CRC32;
import java.util.zip.DeflaterOutputStream;
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

  private void writeChunk(DataOutputStream out, String type, byte[] payload) throws IOException {
    byte[] name = type.getBytes(StandardCharsets.US_ASCII);
    CRC32 crc = new CRC32();
    crc.update(name);
    crc.update(payload);
    out.writeInt(payload.length);
    out.write(name);
    out.write(payload);
    out.writeInt((int) crc.getValue());
  }

  private void writeGrayscalePng(File file, int width, int height) throws IOException {
    ByteArrayOutputStream pixels = new ByteArrayOutputStream();
    try (DeflaterOutputStream compressed = new DeflaterOutputStream(pixels)) {
      // Use one unfiltered, 8-bit grayscale row for the entire fixture.
      byte[] row = new byte[width + 1];
      for (int y = 0; y < height; y++) compressed.write(row);
    }
    byte[] header = ByteBuffer.allocate(13).putInt(width).putInt(height).put((byte) 8).array();
    try (DataOutputStream out = new DataOutputStream(new FileOutputStream(file))) {
      out.writeLong(0x89504e470d0a1a0aL);
      writeChunk(out, "IHDR", header);
      writeChunk(out, "IDAT", pixels.toByteArray());
      writeChunk(out, "IEND", new byte[0]);
    }
  }

  @Test
  public void largePngsAreSampledBeforeScalingWithoutChangingTheSource() throws Exception {
    for (int width : new int[] {3840, 7680}) {
      int height = width * 9 / 16;
      File original = folder.newFile();
      writeGrayscalePng(original, width, height);
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

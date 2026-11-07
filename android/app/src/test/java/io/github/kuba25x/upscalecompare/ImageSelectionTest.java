package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.provider.MediaStore;
import java.io.IOException;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class ImageSelectionTest {
  private static final Uri A = Uri.parse("content://media/picker/images/1");
  private static final Uri B = Uri.parse("content://media/picker/images/2");

  @Test
  public void multiPhotoPickerHasImageFilterAndRequestedLimit() throws Exception {
    for (int limit : new int[] {2, 3, 4}) {
      Intent intent =
          new ImageSelection(1, limit, "photos").createIntent(RuntimeEnvironment.getApplication());
      assertEquals(MediaStore.ACTION_PICK_IMAGES, intent.getAction());
      assertEquals("image/*", intent.getType());
      assertEquals(limit, intent.getIntExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 0));
    }
  }

  @Test
  public void replacingOneOrAddingLastSlotUsesSinglePhotoPicker() throws Exception {
    Intent intent =
        new ImageSelection(1, 1, "photos").createIntent(RuntimeEnvironment.getApplication());
    assertEquals(MediaStore.ACTION_PICK_IMAGES, intent.getAction());
    assertFalse(intent.hasExtra(MediaStore.EXTRA_PICK_IMAGES_MAX));
  }

  @Test
  @Config(sdk = 28)
  public void unavailablePhotoPickerFallsBackToLocalSaf() throws Exception {
    assertSaf(
        new ImageSelection(2, 4, "photos").createIntent(RuntimeEnvironment.getApplication()), true);
  }

  @Test
  public void explicitFilesStillOpensSafOnNewDevices() throws Exception {
    assertSaf(
        new ImageSelection(1, 1, "files").createIntent(RuntimeEnvironment.getApplication()), false);
    assertSaf(
        new ImageSelection(2, 4, "files").createIntent(RuntimeEnvironment.getApplication()), true);
  }

  private void assertSaf(Intent intent, boolean multiple) {
    assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.getAction());
    assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE));
    assertTrue(intent.getBooleanExtra(Intent.EXTRA_LOCAL_ONLY, false));
    assertEquals(multiple, intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false));
    assertArrayEquals(
        new String[] {"image/png", "image/jpeg", "image/webp"},
        intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES));
  }

  @Test
  public void cancelOrEmptyResultHasNoSelections() throws Exception {
    var selection = new ImageSelection(2, 4, "photos");
    assertTrue(selection.parseResult(Activity.RESULT_CANCELED, new Intent().setData(A)).isEmpty());
    assertTrue(selection.parseResult(Activity.RESULT_OK, null).isEmpty());
  }

  @Test
  public void parsesDataAndClipDataInOrderWithoutDuplicateCopies() throws Exception {
    var selection = new ImageSelection(2, 4, "photos");
    Intent intent = new Intent().setData(A);
    ClipData clip = ClipData.newRawUri("", A);
    clip.addItem(new ClipData.Item(B));
    intent.setClipData(clip);
    assertEquals(List.of(A, B), selection.parseResult(Activity.RESULT_OK, intent));
    Intent singleClip = new Intent();
    singleClip.setClipData(ClipData.newRawUri("", A));
    assertEquals(
        List.of(A), new ImageSelection(1, 1, "photos").parseResult(Activity.RESULT_OK, singleClip));
  }

  @Test
  public void countAndSchemeAreCheckedBeforeImport() throws Exception {
    var selection = new ImageSelection(2, 4, "photos");
    assertThrows(IOException.class, () -> selection.validate(List.of(A)));
    selection.validate(List.of(A, B));
    selection.validate(List.of(A, B, A, B));
    assertThrows(IOException.class, () -> selection.validate(List.of(A, B, A, B, A)));
    assertThrows(
        IOException.class, () -> new ImageSelection(1, 1, "files").validate(List.of(A, B)));
    assertThrows(
        IOException.class,
        () -> selection.validate(List.of(A, Uri.parse("file:///tmp/not-granted"))));
    assertThrows(
        IOException.class,
        () -> selection.validate(List.of(A, Uri.parse("https://example.com/image.png"))));
  }

  @Test
  public void rejectsInvalidClientOptions() {
    assertThrows(IOException.class, () -> new ImageSelection(2, 1, "photos"));
    assertThrows(IOException.class, () -> new ImageSelection(1, 5, "photos"));
    assertThrows(IOException.class, () -> new ImageSelection(0, 4, "files"));
    assertThrows(IOException.class, () -> new ImageSelection(2, 4, "unknown"));
  }
}

package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.shadows.ShadowContentResolver;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class OriginalsUriImportTest {
  static class Plugin extends OriginalsPlugin {
    @Override
    public Context getContext() {
      return RuntimeEnvironment.getApplication();
    }
  }

  static class Provider extends ContentProvider {
    File png;
    File gif;
    int opens;

    @Override
    public boolean onCreate() {
      return true;
    }

    private File file(Uri uri) throws FileNotFoundException {
      if (uri.getLastPathSegment().equals("offline"))
        throw new FileNotFoundException("Cloud image is not available offline.");
      return uri.getLastPathSegment().equals("gif") ? gif : png;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
      opens++;
      return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(
        Uri uri, String[] projection, String selection, String[] args, String sort) {
      MatrixCursor cursor =
          new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
      cursor.addRow(new Object[] {"Original.png", png.length()});
      return cursor;
    }

    @Override
    public String getType(Uri uri) {
      return "image/png";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
      throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String s, String[] a) {
      throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues v, String s, String[] a) {
      throw new UnsupportedOperationException();
    }
  }

  Plugin plugin;
  Provider provider;
  File root;
  byte[] bytes;

  @Before
  public void setup() throws Exception {
    Context context = RuntimeEnvironment.getApplication();
    provider = new Provider();
    var info = new android.content.pm.ProviderInfo();
    info.authority = "original-test";
    provider.attachInfo(context, info);
    provider.png = new File(context.getCacheDir(), "fixture.png");
    provider.gif = new File(context.getCacheDir(), "unsupported.gif");
    try (InputStream png = getClass().getResourceAsStream("/picker.png");
        InputStream gif = getClass().getResourceAsStream("/unsupported.gif")) {
      byte[] buffer = new byte[1024];
      int count;
      try (OutputStream out = new FileOutputStream(provider.png)) {
        while ((count = png.read(buffer)) != -1) out.write(buffer, 0, count);
      }
      try (OutputStream out = new FileOutputStream(provider.gif)) {
        while ((count = gif.read(buffer)) != -1) out.write(buffer, 0, count);
      }
    }
    bytes = Files.readAllBytes(provider.png.toPath());
    ShadowContentResolver.registerProviderInternal("original-test", provider);
    root = new File(context.getNoBackupFilesDir(), "originals");
    root.mkdirs();
    // A previously committed comparison, which failed or cancelled imports must retain.
    JSONArray images = new JSONArray();
    for (int n = 1; n <= 2; n++) {
      String id = "00000000-0000-4000-8000-00000000000" + n;
      Files.write(new File(root, id).toPath(), bytes);
      images.put(
          new JSONObject()
              .put("id", id)
              .put("size", bytes.length)
              .put("width", 2)
              .put("height", 3));
    }
    JSONObject session =
        new JSONObject()
            .put("images", images)
            .put("config", new JSONObject().put("selected", new JSONArray("[0,1]")));
    Files.write(
        new File(context.getNoBackupFilesDir(), "comparison.json").toPath(),
        session.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    plugin = new Plugin();
    plugin.load();
  }

  @After
  public void stop() {
    plugin.handleOnDestroy();
  }

  private OriginalsPickerLifecycleTest.Call pick(String... names) throws Exception {
    ClipData clip = ClipData.newRawUri("", Uri.parse("content://original-test/" + names[0]));
    for (int i = 1; i < names.length; i++)
      clip.addItem(new ClipData.Item(Uri.parse("content://original-test/" + names[i])));
    var call =
        new OriginalsPickerLifecycleTest.Call(
            "uri", new JSObject().put("minimum", 2).put("limit", 4).put("source", "photos"));
    Method callback =
        OriginalsPlugin.class.getDeclaredMethod(
            "picked", com.getcapacitor.PluginCall.class, ActivityResult.class);
    Intent data = new Intent();
    data.setClipData(clip);
    callback.setAccessible(true);
    callback.invoke(plugin, call, new ActivityResult(android.app.Activity.RESULT_OK, data));
    assertTrue(call.done.await(20, java.util.concurrent.TimeUnit.SECONDS));
    return call;
  }

  @Test
  public void successfulContentUriImportsPreserveExactBytesAndHash() throws Exception {
    var call = pick("first", "second");
    assertNull(call.error);
    JSONArray images = call.result.getJSONArray("images");
    assertEquals(2, images.length());
    for (int i = 0; i < images.length(); i++) {
      JSONObject image = images.getJSONObject(i);
      assertArrayEquals(bytes, Files.readAllBytes(new File(root, image.getString("id")).toPath()));
      assertEquals(2, image.getInt("width"));
      assertEquals(3, image.getInt("height"));
      StringBuilder hex = new StringBuilder();
      for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes))
        hex.append(String.format("%02x", value & 255));
      assertEquals(hex.toString(), image.getString("sha256"));
    }
  }

  @Test
  public void tooFewAndTooManySelectionsOpenNoNativeStreams() throws Exception {
    assertTrue(pick("one").error.contains("at least 2"));
    assertTrue(pick("one", "two", "three", "four", "five").error.contains("no more than 4"));
    assertEquals(0, provider.opens);
    assertEquals(2, root.listFiles().length);
  }

  @Test
  public void unsupportedFormatAndCloudFailureRollBackPartialCopies() throws Exception {
    assertTrue(pick("valid", "gif").error.contains("PNG, JPEG, or WebP"));
    assertEquals(2, root.listFiles().length);
    assertNotNull(pick("valid", "offline").error);
    assertEquals(2, root.listFiles().length);
    for (File retained : root.listFiles())
      assertArrayEquals(bytes, Files.readAllBytes(retained.toPath()));
  }
}

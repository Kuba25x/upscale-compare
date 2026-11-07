package io.github.kuba25x.upscalecompare;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

@CapacitorPlugin(name = "Originals")
public class OriginalsPlugin extends Plugin {
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Set<String> pending = new HashSet<>();
  private final AtomicBoolean picking = new AtomicBoolean();
  private File root;
  private AtomicFile journal;
  private JSONObject session;
  private boolean initialized;

  @Override
  public void load() {
    root = new File(getContext().getNoBackupFilesDir(), "originals");
    journal = new AtomicFile(new File(getContext().getNoBackupFilesDir(), "comparison.json"));
  }

  private interface Work {
    void run() throws Exception;
  }

  private void run(PluginCall call, Work work) {
    io.execute(
        () -> {
          try {
            initialize();
            work.run();
          } catch (Exception e) {
            call.reject(
                e.getMessage() == null ? "Local storage operation failed." : e.getMessage());
          }
        });
  }

  private void initialize() throws Exception {
    if (initialized) return;
    if (!root.isDirectory() && !root.mkdirs())
      throw new IOException("Cannot create private storage.");
    try (InputStream in = journal.openRead()) {
      ByteArrayOutputStream dataStream = new ByteArrayOutputStream();
      byte[] chunk = new byte[4096];
      int n;
      while ((n = in.read(chunk)) != -1) {
        if (dataStream.size() + n > 128 * 1024) throw new IOException("Invalid saved session.");
        dataStream.write(chunk, 0, n);
      }
      byte[] data = dataStream.toByteArray();
      if (data.length > 128 * 1024) throw new IOException("Invalid saved session.");
      session = new JSONObject(new String(data, StandardCharsets.UTF_8));
      validate(session);
    } catch (FileNotFoundException e) {
      // An unreadable journal must not be mistaken for a brand-new installation.
      if (journal.getBaseFile().exists()
          || new File(journal.getBaseFile().getPath() + ".bak").exists()) throw e;
      session = null;
    }
    // Never delete files when the journal cannot be read or validated.
    initialized = true;
    sweep();
  }

  private File original(String id) throws IOException {
    if (!id.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))
      throw new IOException("Invalid original identifier.");
    return new File(root, id);
  }

  private Set<String> retained(JSONObject state) throws Exception {
    Set<String> ids = new HashSet<>();
    if (state != null) {
      JSONArray images = state.getJSONArray("images");
      for (int i = 0; i < images.length(); i++) ids.add(images.getJSONObject(i).getString("id"));
    }
    return ids;
  }

  private long used() throws IOException {
    long size = 0;
    File[] files = root.listFiles();
    if (files == null) throw new IOException("Cannot inspect private storage.");
    for (File file : files) size = Math.addExact(size, file.length());
    return size;
  }

  private void sweep() throws Exception {
    Set<String> keep = retained(session);
    keep.addAll(pending);
    OriginalPolicy.sweep(root, keep);
  }

  private void validate(JSONObject state) throws Exception {
    JSONArray images = state.getJSONArray("images");
    if (images.length() > 4 || images.length() == 1)
      throw new IOException("Choose two to four images.");
    long total = 0;
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < images.length(); i++) {
      JSONObject image = images.getJSONObject(i);
      String id = image.getString("id");
      File file = original(id);
      if (!ids.add(id) || !file.isFile() || file.length() != image.getLong("size"))
        throw new IOException("A stored original is unavailable.");
      if (file.length() <= 0 || file.length() > OriginalPolicy.FILE_LIMIT)
        throw new IOException("Original exceeds the file limit.");
      OriginalPolicy.dimensions(image.getInt("width"), image.getInt("height"));
      total += file.length();
    }
    if (total > OriginalPolicy.SESSION_LIMIT) throw new IOException("Comparison exceeds 1 GiB.");
    if (images.length() > 0) {
      JSONArray selected = state.getJSONObject("config").getJSONArray("selected");
      int a = selected.getInt(0), b = selected.getInt(1);
      if (a < 0 || b < 0 || a >= images.length() || b >= images.length() || a == b)
        throw new IOException("Invalid comparison selection.");
    }
  }

  private JSObject pathsFor(Collection<String> ids) throws Exception {
    JSObject paths = new JSObject();
    Set<String> allowed = retained(session);
    allowed.addAll(pending);
    for (String id : ids) {
      if (!allowed.contains(id) || !original(id).isFile())
        throw new IOException("Original is unavailable.");
      paths.put(id, Uri.fromFile(original(id)).toString());
    }
    return paths;
  }

  @PluginMethod
  public void restore(PluginCall call) {
    run(
        call,
        () ->
            call.resolve(
                new JSObject()
                    .put("session", session == null ? JSONObject.NULL : session)
                    .put("paths", pathsFor(retained(session)))));
  }

  @PluginMethod
  public void paths(PluginCall call) {
    run(
        call,
        () -> call.resolve(new JSObject().put("paths", pathsFor(call.getArray("ids").toList()))));
  }

  @PluginMethod
  public void save(PluginCall call) {
    run(
        call,
        () -> {
          JSONObject next = call.getObject("session");
          validate(next);
          byte[] bytes = next.toString().getBytes(StandardCharsets.UTF_8);
          if (bytes.length > 128 * 1024) throw new IOException("Session metadata is too large.");
          FileOutputStream out = null;
          try {
            out = journal.startWrite();
            out.write(bytes);
            journal.finishWrite(out);
          } catch (Exception e) {
            if (out != null) journal.failWrite(out);
            throw e;
          }
          session = next;
          pending.removeAll(retained(next));
          try {
            sweep();
            call.resolve(new JSObject());
          } catch (IOException e) {
            call.resolve(
                new JSObject()
                    .put(
                        "warning",
                        "Session saved, but unused originals could not be removed. Cleanup will be"
                            + " retried."));
          }
        });
  }

  @PluginMethod
  public void discard(PluginCall call) {
    run(
        call,
        () -> {
          pending.removeAll(call.getArray("ids").toList());
          sweep();
          call.resolve();
        });
  }

  @PluginMethod
  public void pick(PluginCall call) {
    if (!picking.compareAndSet(false, true)) {
      call.reject("An import is already in progress.");
      return;
    }
    try {
      ImageSelection selection = selection(call);
      Intent intent = selection.createIntent(getContext());
      try {
        // Keep the pre-registered Capacitor callback and saved PluginCall/options for restoration.
        startActivityForResult(call, intent, "picked");
      } catch (ActivityNotFoundException unavailable) {
        if (Intent.ACTION_OPEN_DOCUMENT.equals(intent.getAction())) throw unavailable;
        startActivityForResult(call, selection.documentsIntent(), "picked");
      }
    } catch (Exception e) {
      picking.set(false);
      call.reject("Could not open the image picker: " + e.getMessage());
    }
  }

  private ImageSelection selection(PluginCall call) throws IOException {
    int limit = call.getInt("limit", 4);
    return new ImageSelection(
        call.getInt("minimum", limit == 1 ? 1 : 2), limit, call.getString("source", "photos"));
  }

  @ActivityCallback
  private void picked(PluginCall call, ActivityResult result) {
    if (call == null) {
      picking.set(false);
      return;
    }
    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
      picking.set(false);
      call.resolve(new JSObject().put("images", new JSArray()));
      return;
    }
    // A restored Capacitor call has no live JS consumer. The App restoration handler asks
    // the user to select again; avoid downloading/copying large cloud items just to discard them.
    if (PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())) {
      picking.set(false);
      call.resolve(new JSObject().put("images", new JSArray()).put("interrupted", true));
      return;
    }
    final List<Uri> uris;
    try {
      ImageSelection selection = selection(call);
      uris = selection.parseResult(result.getResultCode(), result.getData());
      if (uris.isEmpty()) {
        picking.set(false);
        call.resolve(new JSObject().put("images", new JSArray()));
        return;
      }
      // Validate count and all URI schemes before initializing storage or opening any streams.
      selection.validate(uris);
    } catch (Exception e) {
      picking.set(false);
      call.reject(e.getMessage());
      return;
    }
    io.execute(
        () -> {
          List<String> batch = new ArrayList<>();
          try {
            initialize();
            JSArray images = new JSArray();
            for (Uri uri : uris) {
              String id = UUID.randomUUID().toString();
              batch.add(id);
              images.put(importOne(uri, id));
              pending.add(id);
            }
            call.resolve(new JSObject().put("images", images));
          } catch (Exception e) {
            pending.removeAll(batch);
            try {
              if (initialized) sweep();
            } catch (Exception cleanup) {
              e.addSuppressed(cleanup);
            }
            call.reject("Import failed: " + e.getMessage());
          } finally {
            picking.set(false);
          }
        });
  }

  private JSONObject importOne(Uri uri, String id) throws Exception {
    if (!"content".equals(uri.getScheme()))
      throw new IOException("Choose an image from Photos or Files.");
    String name = "Screenshot";
    try (Cursor cursor =
        getContext()
            .getContentResolver()
            .query(
                uri,
                new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE},
                null,
                null,
                null)) {
      if (cursor != null && cursor.moveToFirst()) {
        if (!cursor.isNull(0)) name = cursor.getString(0);
        if (!cursor.isNull(1) && cursor.getLong(1) > OriginalPolicy.FILE_LIMIT)
          throw new IOException("File exceeds the provisional 256 MiB limit.");
      }
    }
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
      if (in == null)
        throw new IOException(
            "The selected image is unavailable. Cloud items need network access until copied"
                + " locally.");
      BitmapFactory.decodeStream(in, null, bounds);
    }
    OriginalPolicy.dimensions(bounds.outWidth, bounds.outHeight);
    if (!Arrays.asList("image/png", "image/jpeg", "image/webp").contains(bounds.outMimeType))
      throw new IOException("Choose PNG, JPEG, or WebP images.");
    File file = original(id);
    OriginalPolicy.Copy copied;
    try (InputStream in = getContext().getContentResolver().openInputStream(uri);
        FileOutputStream out = new FileOutputStream(file)) {
      if (in == null)
        throw new IOException(
            "The selected image is unavailable. Cloud items need network access until copied"
                + " locally.");
      copied =
          OriginalPolicy.copy(
              in,
              out,
              Math.min(OriginalPolicy.FILE_LIMIT, OriginalPolicy.STORE_LIMIT - used()),
              root::getUsableSpace);
      out.getFD().sync();
    }
    // The provider may change between reads. Validate the actual private copy too.
    BitmapFactory.Options actual = new BitmapFactory.Options();
    actual.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(file.getPath(), actual);
    OriginalPolicy.dimensions(actual.outWidth, actual.outHeight);
    if (actual.outWidth != bounds.outWidth
        || actual.outHeight != bounds.outHeight
        || !Objects.equals(actual.outMimeType, bounds.outMimeType))
      throw new IOException("The source changed during import.");
    int orientation =
        new androidx.exifinterface.media.ExifInterface(file.getPath())
            .getAttributeInt(androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION, 1);
    boolean rotated = orientation >= 5 && orientation <= 8;
    return new JSONObject()
        .put("id", id)
        .put("name", name.substring(0, Math.min(name.length(), 240)))
        .put("type", actual.outMimeType)
        .put("width", rotated ? actual.outHeight : actual.outWidth)
        .put("height", rotated ? actual.outWidth : actual.outHeight)
        .put("size", copied.size())
        .put("sha256", copied.sha256());
  }

  @Override
  protected void handleOnDestroy() {
    io.shutdownNow();
  }
}

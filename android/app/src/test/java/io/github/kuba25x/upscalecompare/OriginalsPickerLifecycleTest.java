package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class OriginalsPickerLifecycleTest {
  public static class TestActivity extends MainActivity {
    @Override
    public void onCreate(android.os.Bundle state) {
      // Robolectric has no real Chromium ServiceWorkerController. The activity result
      // registry and Capacitor call persistence remain the real production implementations.
      config =
          new com.getcapacitor.CapConfig.Builder(this)
              .setResolveServiceWorkerRequests(false)
              .create();
      super.onCreate(state);
    }
  }

  static class Call extends PluginCall {
    JSObject result;
    String error;
    CountDownLatch done = new CountDownLatch(1);

    Call(String callbackId, JSObject options) {
      super(null, "Originals", callbackId, "pick", options);
    }

    @Override
    public void resolve(JSObject result) {
      this.result = result;
      done.countDown();
    }

    @Override
    public void reject(String message) {
      error = message;
      done.countDown();
    }
  }

  private void result(OriginalsPlugin plugin, Call call, int code, Intent data) throws Exception {
    Method callback =
        OriginalsPlugin.class.getDeclaredMethod("picked", PluginCall.class, ActivityResult.class);
    callback.setAccessible(true);
    callback.invoke(plugin, call, new ActivityResult(code, data));
    assertTrue(call.done.await(5, TimeUnit.SECONDS));
  }

  @Test
  public void tooFewOrInvalidUrisNeverInitializeStorage() throws Exception {
    var plugin =
        new OriginalsPlugin(); // No bridge/context: any attempted import/storage access would fail.
    var options = new JSObject().put("minimum", 2).put("limit", 4).put("source", "photos");
    var call = new Call("count", options);
    result(
        plugin,
        call,
        Activity.RESULT_OK,
        new Intent().setData(Uri.parse("content://media/picker/1")));
    assertTrue(call.error.contains("at least 2"));
    assertNull(call.result);
    var invalid = new Call("scheme", options);
    ClipData clip = ClipData.newRawUri("", Uri.parse("content://media/picker/1"));
    clip.addItem(new ClipData.Item(Uri.parse("file:///not-granted")));
    Intent data = new Intent();
    data.setClipData(clip);
    result(plugin, invalid, Activity.RESULT_OK, data);
    assertTrue(invalid.error.contains("content URIs"));
  }

  @Test
  public void cancellationAndRestoredCallsDoNotOpenOrCopyUris() throws Exception {
    var plugin = new OriginalsPlugin();
    var options = new JSObject().put("minimum", 2).put("limit", 4).put("source", "photos");
    var cancelled = new Call("cancel", options);
    result(plugin, cancelled, Activity.RESULT_CANCELED, new Intent());
    assertNull(cancelled.error);
    assertEquals(0, cancelled.result.getJSONArray("images").length());
    var restored = new Call(PluginCall.CALLBACK_ID_DANGLING, options);
    result(
        plugin,
        restored,
        Activity.RESULT_OK,
        new Intent().setData(Uri.parse("content://cloud/not-downloaded")));
    assertTrue(restored.result.getBoolean("interrupted"));
    assertEquals(0, restored.result.getJSONArray("images").length());
    assertNull(restored.error);
  }

  @Test
  public void missingPhotoActivityLaunchesSafThroughTheSameCapacitorCallback() throws Exception {
    class UnavailablePicker extends OriginalsPlugin {
      final java.util.List<Intent> attempts = new java.util.ArrayList<>();

      @Override
      public android.content.Context getContext() {
        return org.robolectric.RuntimeEnvironment.getApplication();
      }

      @Override
      public void startActivityForResult(PluginCall call, Intent intent, String callback) {
        assertEquals("picked", callback);
        attempts.add(intent);
        if (attempts.size() == 1)
          throw new android.content.ActivityNotFoundException("No picker activity");
      }
    }
    var plugin = new UnavailablePicker();
    var call =
        new Call(
            "fallback", new JSObject().put("minimum", 2).put("limit", 4).put("source", "photos"));
    plugin.pick(call);
    assertEquals(2, plugin.attempts.size());
    assertEquals("android.provider.action.PICK_IMAGES", plugin.attempts.get(0).getAction());
    assertEquals(Intent.ACTION_OPEN_DOCUMENT, plugin.attempts.get(1).getAction());
    result(plugin, call, Activity.RESULT_CANCELED, new Intent());
    assertNull(call.error);
  }

  @Test
  public void capacitorOwnsLauncherAndRetainsCallOptionsForActivityRecreation() throws Exception {
    android.content.pm.PackageInfo webview = new android.content.pm.PackageInfo();
    webview.packageName = "com.google.android.webview";
    webview.versionName = "140.0";
    org.robolectric.shadows.ShadowWebView.setCurrentWebViewPackage(webview);
    var controller = Robolectric.buildActivity(TestActivity.class).setup();
    var activity = controller.get();
    try {
      var plugin = (OriginalsPlugin) activity.getBridge().getPlugin("Originals").getInstance();
      var options = new JSObject().put("minimum", 2).put("limit", 3).put("source", "photos");
      var call = new Call("lifecycle", options);
      plugin.pick(call);
      var started = shadowOf(activity).getNextStartedActivityForResult();
      assertNotNull(started);
      assertEquals("android.provider.action.PICK_IMAGES", started.intent.getAction());
      assertSame(call, activity.getBridge().getSavedCall("lifecycle"));
      // Capacitor serializes the original method/options when saving the pending activity.
      android.os.Bundle saved = new android.os.Bundle();
      activity.getBridge().saveInstanceState(saved);
      activity.getBridge().restoreInstanceState(saved);
      Method getRestored =
          com.getcapacitor.Bridge.class.getDeclaredMethod("getPluginCallForLastActivity");
      getRestored.setAccessible(true);
      var restored = (PluginCall) getRestored.invoke(activity.getBridge());
      assertEquals(PluginCall.CALLBACK_ID_DANGLING, restored.getCallbackId());
      assertEquals("pick", restored.getMethodName());
      assertEquals(3, (int) restored.getInt("limit"));
      assertEquals(2, (int) restored.getInt("minimum"));
      assertEquals("photos", restored.getString("source"));
    } finally {
      controller.pause().stop().destroy();
    }
  }
}

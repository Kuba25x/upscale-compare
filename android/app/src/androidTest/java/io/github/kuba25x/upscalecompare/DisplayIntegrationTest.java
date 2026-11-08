package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.ParcelFileDescriptor;
import android.view.Surface;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.SdkSuppress;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Actual window-manager/insets checks; run on the isolated systemUi variant, never user app data.
 */
@RunWith(AndroidJUnit4.class)
@SdkSuppress(minSdkVersion = 36)
public class DisplayIntegrationTest {
  private ActivityScenario<MainActivity> scenario;

  private interface Check {
    void run() throws Exception;
  }

  private void eventually(Check check) throws Exception {
    Throwable last = null;
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
    do {
      try {
        check.run();
        return;
      } catch (AssertionError | Exception failure) {
        last = failure;
      }
      Thread.sleep(100);
    } while (System.nanoTime() < until);
    throw new AssertionError("Display state did not settle", last);
  }

  private String js(String script) throws Exception {
    AtomicReference<String> result = new AtomicReference<>();
    CountDownLatch done = new CountDownLatch(1);
    scenario.onActivity(
        a ->
            a.getBridge()
                .getWebView()
                .evaluateJavascript(
                    script,
                    value -> {
                      result.set(value);
                      done.countDown();
                    }));
    assertTrue(done.await(10, TimeUnit.SECONDS));
    return result.get();
  }

  private void bars(boolean status, boolean navigation) throws Exception {
    eventually(
        () ->
            scenario.onActivity(
                a -> {
                  WindowInsetsCompat insets =
                      ViewCompat.getRootWindowInsets(a.getWindow().getDecorView());
                  assertNotNull(insets);
                  assertEquals(status, insets.isVisible(WindowInsetsCompat.Type.statusBars()));
                  assertEquals(
                      navigation, insets.isVisible(WindowInsetsCompat.Type.navigationBars()));
                  assertFalse(
                      WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView())
                          .isAppearanceLightStatusBars());
                  assertFalse(
                      WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView())
                          .isAppearanceLightNavigationBars());
                  assertFalse(a.getWindow().isNavigationBarContrastEnforced());
                }));
  }

  private void click(String selector) throws Exception {
    assertEquals(
        "true",
        js(
            "(() => { const e=document.querySelector('"
                + selector
                + "'); if(!e) return false; e.click(); return true; })()"));
  }

  private void rotate(int orientation, boolean landscape) throws Exception {
    scenario.onActivity(a -> a.setRequestedOrientation(orientation));
    eventually(
        () -> scenario.onActivity(a -> assertEquals(landscape, a.displayLayout.isLandscape())));
    // This emulator has a portrait natural orientation; wait for the actual display rotation.
    int rotation =
        orientation == ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
            ? Surface.ROTATION_270
            : landscape ? Surface.ROTATION_90 : Surface.ROTATION_0;
    eventually(
        () -> scenario.onActivity(a -> assertEquals(rotation, a.getDisplay().getRotation())));
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    "document.querySelector('.app').classList.contains('android-landscape') === "
                        + landscape)));
  }

  private String shell(String command) throws Exception {
    try (ParcelFileDescriptor result =
            InstrumentationRegistry.getInstrumentation()
                .getUiAutomation()
                .executeShellCommand(command);
        var in = new ParcelFileDescriptor.AutoCloseInputStream(result)) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  private void awaitVisualFrame() throws Exception {
    CountDownLatch presented = new CountDownLatch(1);
    scenario.onActivity(
        a -> {
          var web = a.getBridge().getWebView();
          web.postVisualStateCallback(
              System.nanoTime(),
              new android.webkit.WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                  // The next draw includes the DOM updates acknowledged by WebView. Wait across
                  // two animation frames so that draw can reach the screen compositor.
                  web.postOnAnimation(() -> web.postOnAnimation(presented::countDown));
                }
              });
        });
    assertTrue(
        "WebView did not present the requested visual state",
        presented.await(10, TimeUnit.SECONDS));
  }

  private boolean colorNear(int pixel, int red, int green, int blue) {
    return Math.abs(Color.red(pixel) - red) <= 2
        && Math.abs(Color.green(pixel) - green) <= 2
        && Math.abs(Color.blue(pixel) - blue) <= 2;
  }

  private void screenshot(String name) throws Exception {
    awaitVisualFrame();
    AtomicReference<JSObject> state = new AtomicReference<>();
    AtomicReference<Integer> statusHeight = new AtomicReference<>();
    scenario.onActivity(
        a -> {
          state.set(a.displayLayout.snapshot());
          statusHeight.set(
              ViewCompat.getRootWindowInsets(a.getWindow().getDecorView())
                  .getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars())
                  .top);
        });
    // Native visibility/DOM callbacks can precede presentation. The synthetic fixture
    // leaves a known background at these sample points, independently of layout flags.
    eventually(
        () -> {
          Bitmap frame =
              InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
          assertNotNull(frame);
          try {
            if (name.equals("landscape-transient-bars")) {
              int white = 0;
              for (int y = 0; y < statusHeight.get() * .6; y++)
                for (int x = 0; x < frame.getWidth(); x++) {
                  int pixel = frame.getPixel(x, y);
                  if (Color.red(pixel) > 220 && Color.green(pixel) > 220 && Color.blue(pixel) > 220)
                    white++;
                }
              assertTrue("Transient status icons have not reached the compositor", white > 10);
            } else {
              boolean minimalist = state.get().getBool("minimalist");
              int y = minimalist ? 2 : state.get().getInteger("layoutTop") + 2;
              int pixel = frame.getPixel(frame.getWidth() / 4, y);
              assertTrue(
                  "Screenshot still shows the previous application mode: " + name,
                  minimalist ? colorNear(pixel, 23, 25, 30) : colorNear(pixel, 20, 21, 25));
            }
          } finally {
            frame.recycle();
          }
        });
    if (name.equals("portrait-normal")) {
      // WindowInsets delivery precedes compositor presentation; sample a settled frame.
      eventually(
          () -> {
            Bitmap frame =
                InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
            assertNotNull(frame);
            try {
              for (int y : new int[] {2, frame.getHeight() - 3}) {
                int pixel = frame.getPixel(frame.getWidth() / 4, y);
                assertTrue(
                    "System bar background is disconnected from the app",
                    Math.abs(Color.red(pixel) - 16) <= 2
                        && Math.abs(Color.green(pixel) - 17) <= 2
                        && Math.abs(Color.blue(pixel) - 20) <= 2);
              }
            } finally {
              frame.recycle();
            }
          });
    }
    // UTP uninstalls the isolated app after the suite; keep CI evidence outside app data.
    shell("mkdir -p /data/local/tmp/upscale-compare-system-ui");
    shell("screencap -p /data/local/tmp/upscale-compare-system-ui/" + name + ".png");
  }

  private void seedIsolatedSession() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    assertTrue(
        "Refusing to change normal app data", context.getPackageName().endsWith(".systemuitest"));
    File root = new File(context.getNoBackupFilesDir(), "originals");
    assertTrue(root.isDirectory() || root.mkdirs());
    Bitmap bitmap = Bitmap.createBitmap(2, 3, Bitmap.Config.ARGB_8888);
    bitmap.eraseColor(Color.GREEN);
    JSONArray images = new JSONArray();
    for (int i = 1; i <= 2; i++) {
      String id = "00000000-0000-4000-8000-00000000000" + i;
      File file = new File(root, id);
      try (var out = new FileOutputStream(file)) {
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
      }
      StringBuilder hash = new StringBuilder();
      for (byte b : MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath())))
        hash.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
      images.put(
          new JSONObject()
              .put("id", id)
              .put("name", i + ".png")
              .put("label", "Image " + i)
              .put("width", 2)
              .put("height", 3)
              .put("size", file.length())
              .put("type", "image/png")
              .put("sha256", hash.toString())
              .put("metadata", new JSONObject()));
    }
    bitmap.recycle();
    JSONObject session =
        new JSONObject()
            .put("images", images)
            .put("metadata", new JSONObject())
            .put(
                "config",
                new JSONObject(
                    "{\"mode\":\"split\",\"selected\":[0,1],\"divider\":0.5,\"view\":{\"zoom\":null,\"center\":{\"x\":1,\"y\":1.5}}}"));
    Files.write(
        new File(context.getNoBackupFilesDir(), "comparison.json").toPath(),
        session.toString().getBytes(StandardCharsets.UTF_8));
  }

  private void assertEdgeToEdgeAndSafeExit() throws Exception {
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    "(() => { const s=document.querySelector('.stage').getBoundingClientRect(),"
                        + " e=document.querySelector('.android-fullscreen-exit').getBoundingClientRect();"
                        + " return s.x===0 && s.y===0 && Math.abs(s.width-innerWidth)<1 &&"
                        + " e.right<=innerWidth && e.bottom<=s.bottom && e.width>=48; })()")));
    eventually(
        () ->
            scenario.onActivity(
                a -> {
                  JSObject state = a.displayLayout.snapshot();
                  int[] origin = new int[2];
                  a.getBridge().getWebView().getLocationOnScreen(origin);
                  assertArrayEquals(new int[] {0, 0}, origin);
                  assertEquals(
                      a.getWindow().getDecorView().getWidth(),
                      a.getBridge().getWebView().getWidth());
                  assertEquals(
                      a.getWindow().getDecorView().getHeight(),
                      a.getBridge().getWebView().getHeight());
                  assertTrue(
                      "The emulator must enable a display cutout overlay",
                      state.optJSONArray("cutouts").length() > 0);
                  assertEquals(0, state.getInteger("layoutTop").intValue());
                }));
    // Native cutout/gesture distances are compared with the real DOM control rectangle.
    AtomicReference<JSObject> snapshot = new AtomicReference<>();
    scenario.onActivity(a -> snapshot.set(a.displayLayout.snapshot()));
    JSObject state = snapshot.get();
    assertEquals(
        "true",
        js(
            "(() => { const"
                + " e=document.querySelector('.android-fullscreen-exit').getBoundingClientRect(),"
                + " d=devicePixelRatio; return e.left*d >= "
                + state.getInteger("safeLeft")
                + " && e.right*d <= innerWidth*d-"
                + state.getInteger("safeRight")
                + " && e.bottom*d <= innerHeight*d-"
                + state.getInteger("safeBottom")
                + "; })()"));
  }

  @Test
  public void realWindowBarsCutoutsPickerResumeBackAndRecreation() throws Exception {
    seedIsolatedSession();
    try (ActivityScenario<MainActivity> active = ActivityScenario.launch(MainActivity.class)) {
      scenario = active;
      rotate(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, false);
      eventually(() -> assertEquals("true", js("!!document.querySelector('.stage')")));
      bars(true, true);
      screenshot("portrait-normal");
      click(".fullscreen-button");
      bars(false, true);
      assertEdgeToEdgeAndSafeExit();
      screenshot("portrait-minimalist");
      for (int orientation :
          new int[] {
            ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE,
            ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
          }) {
        rotate(orientation, true);
        bars(false, false);
        assertEdgeToEdgeAndSafeExit();
        screenshot("landscape-minimalist-" + orientation);
      }
      click(".android-fullscreen-exit");
      bars(false, false);
      eventually(
          () -> {
            JSONObject geometry =
                new JSONObject(
                    js(
                        "(() => { const"
                            + " h=document.querySelector('.app-header').getBoundingClientRect(),"
                            + " m=document.querySelector('.mode-controls').getBoundingClientRect(),"
                            + " a=document.querySelector('.header-actions').getBoundingClientRect();"
                            + " return {header:h.height,"
                            + " safeTop:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--android-safe-top')),"
                            + " stage:document.querySelector('.stage').getBoundingClientRect().height,"
                            + " height:innerHeight, modeCenter:m.y+m.height/2,"
                            + " actionsCenter:a.y+a.height/2}; })()"));
            assertTrue(
                "Expected one compact row plus measured safety: " + geometry,
                Math.abs(geometry.getDouble("header") - 52 - geometry.getDouble("safeTop")) < 1
                    && Math.abs(
                            geometry.getDouble("modeCenter") - geometry.getDouble("actionsCenter"))
                        < 2
                    && geometry.getDouble("stage") > geometry.getDouble("height") * .7);
          });
      click(".android-images-toggle");
      assertEquals(
          "true",
          js("document.querySelector('.image-selection-bar').getBoundingClientRect().height > 0"));
      click(".android-images-toggle");
      screenshot("landscape-normal");
      String viewportBeforeReveal =
          js("document.querySelector('.stage').getBoundingClientRect().height");
      AtomicReference<JSObject> dimensions = new AtomicReference<>();
      scenario.onActivity(a -> dimensions.set(a.displayLayout.snapshot()));
      int swipeX = dimensions.get().getInteger("width") / 2;
      int swipeY = dimensions.get().getInteger("height") / 3;
      shell("input swipe " + swipeX + " 0 " + swipeX + " " + swipeY + " 300");
      // Transient bars deliberately do not change app-visible WindowInsets visibility.
      // Inspect the emulator's actual window policy, not the app's requested hidden bits.
      eventually(
          () ->
              assertTrue(
                  shell("dumpsys window displays")
                      .lines()
                      .anyMatch(
                          line ->
                              line.contains("mShowingTransientTypes=")
                                  && line.contains("statusBars"))));
      assertEquals(
          viewportBeforeReveal,
          js("document.querySelector('.stage').getBoundingClientRect().height"));
      screenshot("landscape-transient-bars");
      eventually(
          () -> assertFalse(shell("dumpsys window displays").contains("mShowingTransientTypes=")));
      bars(false, false);
      // Launch the real Photo Picker through the existing Capacitor callback and cancel it.
      AtomicReference<MainActivity> activity = new AtomicReference<>();
      CountDownLatch cancelled = new CountDownLatch(1);
      scenario.onActivity(
          a -> {
            activity.set(a);
            PluginCall call =
                new PluginCall(
                    null,
                    "Originals",
                    "display-test-picker",
                    "pick",
                    new JSObject().put("minimum", 2).put("limit", 4).put("source", "photos")) {
                  @Override
                  public void resolve(JSObject result) {
                    cancelled.countDown();
                  }

                  @Override
                  public void reject(String message) {
                    throw new AssertionError(message);
                  }
                };
            ((OriginalsPlugin) a.getBridge().getPlugin("Originals").getInstance()).pick(call);
          });
      eventually(() -> assertFalse(activity.get().hasWindowFocus()));
      shell("input keyevent KEYCODE_BACK");
      assertTrue("Picker cancellation was not delivered", cancelled.await(20, TimeUnit.SECONDS));
      eventually(() -> assertTrue(activity.get().hasWindowFocus()));
      bars(false, false);
      scenario.moveToState(Lifecycle.State.CREATED).moveToState(Lifecycle.State.RESUMED);
      bars(false, false);
      click(".fullscreen-button");
      bars(false, false);
      scenario.recreate();
      eventually(
          () ->
              assertEquals(
                  "true",
                  js(
                      "!!document.querySelector('.android-comparison-fullscreen"
                          + " .android-fullscreen-exit')")));
      bars(false, false);
      rotate(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, false);
      bars(false, true);
      assertEdgeToEdgeAndSafeExit();
      shell("input keyevent KEYCODE_BACK");
      bars(true, true);
      eventually(
          () ->
              assertEquals(
                  "false",
                  js(
                      "document.querySelector('.app').classList.contains('android-comparison-fullscreen')")));
    }
  }
}

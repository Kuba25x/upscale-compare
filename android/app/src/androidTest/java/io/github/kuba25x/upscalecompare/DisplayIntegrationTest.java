package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
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
        dismissSystemTutorial();
        check.run();
        return;
      } catch (AssertionError | Exception failure) {
        last = failure;
      }
      Thread.sleep(100);
    } while (System.nanoTime() < until);
    throw new AssertionError("Display state did not settle", last);
  }

  private void dismissSystemTutorial() throws Exception {
    boolean shown =
        shell("dumpsys window windows")
            .lines()
            .anyMatch(
                line -> line.contains("Window #") && line.contains("ImmersiveModeConfirmation"));
    if (!shown) return;
    AtomicReference<JSObject> size = new AtomicReference<>();
    scenario.onActivity(a -> size.set(a.displayLayout.snapshot()));
    // Android confirms this specific first-use tutorial when a system edge swipe
    // successfully reveals the bars. No app or permission dialog is acknowledged.
    int x = size.get().getInteger("width") / 2;
    int y = size.get().getInteger("height") / 3;
    shell("input swipe " + x + " 0 " + x + " " + y + " 300");
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
                    "document.querySelector('.app').classList.contains('comparison-compact') === "
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
    shell("mkdir -p /data/local/tmp/upscale-compare-system-ui");
    try {
      assertScreenshot(name);
    } catch (AssertionError | Exception failure) {
      shell("mkdir -p /data/local/tmp/upscale-compare-system-ui");
      shell("screencap -p /data/local/tmp/upscale-compare-system-ui/" + name + "-failed.png");
      System.err.println(
          "Visual failure DOM: "
              + js(
                  "JSON.stringify({scrollX,scrollY,header:document.querySelector('.app-header').getBoundingClientRect().toJSON(),app:document.querySelector('.app').getBoundingClientRect().toJSON(),stage:document.querySelector('.stage').getBoundingClientRect().toJSON(),background:getComputedStyle(document.querySelector('.app-header')).backgroundColor,active:document.activeElement?.outerHTML.slice(0,300),viewport:{height:visualViewport.height,offsetTop:visualViewport.offsetTop,pageTop:visualViewport.pageTop}})"));
      scenario.onActivity(
          a -> {
            var web = a.getBridge().getWebView();
            int[] location = new int[2];
            web.getLocationOnScreen(location);
            System.err.println(
                "Visual failure native: "
                    + a.displayLayout.snapshot()
                    + ", scroll="
                    + web.getScrollX()
                    + ","
                    + web.getScrollY()
                    + ", location="
                    + java.util.Arrays.toString(location));
          });
      throw failure;
    }
  }

  private Bitmap captureFrame(String name) throws Exception {
    String path = "/data/local/tmp/upscale-compare-system-ui/" + name + ".png";
    shell("screencap -p " + path);
    try (var pipe =
            InstrumentationRegistry.getInstrumentation()
                .getUiAutomation()
                .executeShellCommand("cat " + path);
        var in = new ParcelFileDescriptor.AutoCloseInputStream(pipe)) {
      Bitmap frame = BitmapFactory.decodeStream(in);
      assertNotNull("The native screen capture could not be decoded", frame);
      return frame;
    }
  }

  private void assertScreenshot(String name) throws Exception {
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
    boolean portraitControls = name.equals("portrait-normal") || name.equals("portrait-three-button");
    boolean portraitLanding = name.startsWith("portrait-landing");
    int panelGapX = portraitControls ? portraitControlGapX() : 0;
    // Native visibility/DOM callbacks can precede presentation. The synthetic fixture
    // leaves a known background at these sample points, independently of layout flags.
    eventually(
        () -> {
          Bitmap frame = captureFrame(name);
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
                  "Unexpected mode pixel: "
                      + name
                      + ", color="
                      + Integer.toHexString(pixel)
                      + ", y="
                      + y,
                  minimalist ? colorNear(pixel, 23, 25, 30) : colorNear(pixel, 20, 21, 25));
            }
            if (portraitControls || portraitLanding) {
              int x = frame.getWidth() / 4;
              assertTrue("Status bar matches the portrait header", colorNear(frame.getPixel(x, 2), 20, 21, 25));
            }
            if (portraitControls) {
              int x = frame.getWidth() / 4;
              int panelBottom = frame.getHeight() - state.get().getInteger("layoutBottom");
              assertTrue(
                  "The gap between controls shows the panel surface",
                  colorNear(frame.getPixel(panelGapX, panelBottom - 2), 20, 21, 25));
              assertTrue(
                  "Panel surface continues through the bottom inset",
                  colorNear(frame.getPixel(x, frame.getHeight() - 3), 20, 21, 25));
            }
            if (portraitLanding) {
              int x = frame.getWidth() / 4;
              int landingBottom = frame.getHeight() - state.get().getInteger("layoutBottom");
              assertTrue("Landing surface meets the navigation area",
                  colorNear(frame.getPixel(x, landingBottom - 2), 16, 17, 20));
              assertTrue("Navigation area matches the landing surface",
                  colorNear(frame.getPixel(x, frame.getHeight() - 3), 16, 17, 20));
            }
          } finally {
            frame.recycle();
          }
        });
  }

  private void seedIsolatedSession() throws Exception {
    seedIsolatedSession(false);
  }

  private void seedIsolatedSession(boolean mismatch) throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    assertTrue(
        "Refusing to change normal app data", context.getPackageName().endsWith(".systemuitest"));
    File root = new File(context.getNoBackupFilesDir(), "originals");
    assertTrue(root.isDirectory() || root.mkdirs());
    JSONArray images = new JSONArray();
    for (int i = 1; i <= 2; i++) {
      int width = mismatch ? (i == 1 ? 320 : 160) : 2;
      int height = mismatch ? 240 : 3;
      Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
      bitmap.eraseColor(mismatch && i == 2 ? Color.BLUE : Color.GREEN);
      String id = "00000000-0000-4000-8000-00000000000" + i;
      File file = new File(root, id);
      try (var out = new FileOutputStream(file)) {
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
      }
      bitmap.recycle();
      StringBuilder hash = new StringBuilder();
      for (byte b : MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath())))
        hash.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
      images.put(
          new JSONObject()
              .put("id", id)
              .put("name", i + ".png")
              .put("label", "Image " + i)
              .put("width", width)
              .put("height", height)
              .put("size", file.length())
              .put("type", "image/png")
              .put("sha256", hash.toString())
              .put("metadata", new JSONObject()));
    }
    JSONObject center = new JSONObject().put("x", mismatch ? 160 : 1).put("y", mismatch ? 120 : 1.5);
    JSONObject session =
        new JSONObject()
            .put("images", images)
            .put("metadata", new JSONObject())
            .put(
                "config",
                new JSONObject().put("mode", "split").put("selected", new JSONArray("[0,1]"))
                    .put("divider", 0.5).put("view", new JSONObject().put("zoom", JSONObject.NULL).put("center", center)));
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
                        + " e=document.querySelector('.minimalist-exit').getBoundingClientRect();"
                        + " return s.x===0 && s.y===0 && Math.abs(s.width-innerWidth)<1 &&"
                        + " e.right<=innerWidth && e.bottom<=s.bottom && e.width>=48; })()")));
    assertDividerArtwork();
    assertDividerEdges();
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
                + " e=document.querySelector('.minimalist-exit').getBoundingClientRect(),"
                + " d=devicePixelRatio; return e.left*d >= "
                + state.getInteger("safeLeft")
                + " && e.right*d <= innerWidth*d-"
                + state.getInteger("safeRight")
                + " && e.bottom*d <= innerHeight*d-"
                + state.getInteger("safeBottom")
                + "; })()"));
  }

  private void assertDividerArtwork() throws Exception {
    assertEquals(
        "true",
        js(
            """
            (() => {
              const handle = document.querySelector('.divider-handle');
              const arrows = [...handle.querySelectorAll('svg path')];
              if (handle.textContent.trim() || handle.children.length !== 2 || arrows.length !== 2)
                return false;
              const midpoint = element => {
                const { x, y, width, height } = element.getBoundingClientRect();
                return [x + width / 2, y + height / 2];
              };
              const [x, y] = midpoint(handle);
              const [[left, leftY], [right, rightY]] = arrows.map(midpoint);
              const line = getComputedStyle(handle.parentElement, '::before');
              const stage = document.querySelector('.stage').getBoundingClientRect();
              return left < x && right > x && Math.abs((left + right) / 2 - x) < 1
                && Math.abs(leftY - y) < 1 && Math.abs(rightY - y) < 1
                && line.content === '""' && line.width === '1px'
                && Math.abs(parseFloat(line.height) - stage.height) < 1;
            })()
            """));
  }

  private void assertDividerEdges() throws Exception {
    for (int percent : new int[] {0, 100, 50}) {
      String key = percent == 100 ? "End" : percent == 0 ? "Home" : "ArrowLeft";
      assertEquals(
          "true",
          js(
              """
              (() => {
                const slider = document.querySelector('.divider');
                const key = %s;
                for (let i = 0; i < (key === 'ArrowLeft' ? 5 : 1); i++)
                  slider.dispatchEvent(new KeyboardEvent('keydown', {
                    bubbles: true, cancelable: true, key, shiftKey: key === 'ArrowLeft'
                  }));
                return true;
              })()
              """.formatted(JSONObject.quote(key))));
      eventually(
          () ->
              assertEquals(
                  "true",
                  js(
                      """
                      (() => {
                        const stage = document.querySelector('.stage');
                        const bounds = stage.getBoundingClientRect();
                        const slider = stage.querySelector('.divider');
                        const handle = slider.querySelector('.divider-handle').getBoundingClientRect();
                        const line = getComputedStyle(slider, '::before');
                        const clip = layer => {
                          const [top, right = top, , left = right] = getComputedStyle(layer).clipPath
                            .slice(6, -1).split(/\\s+/);
                          const pixels = side => side.endsWith('%%')
                            ? parseFloat(side) / 100 * bounds.width : parseFloat(side);
                          return [bounds.left + pixels(left), bounds.right - pixels(right)];
                        };
                        const [a, b] = [...stage.querySelectorAll('.split-layer')].map(clip);
                        const expected = bounds.left + bounds.width * %d / 100;
                        return [a[1], b[0], handle.left + handle.width / 2,
                          slider.getBoundingClientRect().left + parseFloat(line.left) + parseFloat(line.width) / 2
                        ].every(x => Math.abs(x - expected) < 0.05);
                      })()
                      """.formatted(percent))));
    }
  }

  private void assertLandingBrandCentered() throws Exception {
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const header = document.querySelector('.app:not(.has-images) .app-header');
                      if (!header || !document.querySelector('.landing')) return false;
                      const bounds = header.getBoundingClientRect();
                      const style = getComputedStyle(header);
                      const logo = header.querySelector('.brand-mark').getBoundingClientRect();
                      const title = header.querySelector('.brand-name').getBoundingClientRect();
                      const left = bounds.left + parseFloat(style.paddingLeft);
                      const right = bounds.right - parseFloat(style.paddingRight);
                      return logo.left >= left && title.right <= right
                        && Math.abs((logo.left + title.right) / 2 - (left + right) / 2) < 1;
                    })()
                    """)));
  }

  private void assertManageImagesPreviews() throws Exception {
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const previews = [...document.querySelectorAll('dialog[open] .upload-list img')];
                      return previews.length === 2 && previews.every(img =>
                        img.src.startsWith('data:image/png;base64,') && img.complete &&
                        img.naturalWidth === 2 && img.naturalHeight === 3);
                    })()
                    """)));
  }

  private void setFirstImageLabel(String label) throws Exception {
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const input = document.querySelector('dialog[open] input[aria-label="Label for 1.png"]');
                      if (!input) return false;
                      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                        .set.call(input, %s);
                      input.dispatchEvent(new Event('input', {bubbles: true}));
                      return true;
                    })()
                    """.formatted(JSONObject.quote(label)))));
  }

  private void assertPortraitZoomMenu() throws Exception {
    assertEquals(
        "true",
        js(
            """
            (() => {
              const zoom = document.querySelector('.comparison-phone-portrait .phone-zoom-trigger');
              if (!zoom || zoom.textContent.trim() !== 'Fit') return false;
              const toolbar = zoom.parentElement;
              if (toolbar.scrollWidth > toolbar.clientWidth || zoom.getBoundingClientRect().height < 44)
                return false;
              return true;
            })()
            """));
    js("document.querySelector('.inspection-toolbar button').focus()");
    shell("input keyevent KEYCODE_TAB");
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const zoom = document.querySelector('.phone-zoom-trigger');
                      return document.activeElement === zoom
                        && getComputedStyle(zoom).outlineStyle === 'solid';
                    })()
                    """)));
    shell("input keyevent KEYCODE_ENTER");
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const menu = document.querySelector('.zoom-presets:popover-open');
                      if (!menu) return false;
                      const box = menu.getBoundingClientRect();
                      const zoom = document.querySelector('.phone-zoom-trigger').getBoundingClientRect();
                      return Math.abs(zoom.top - box.bottom - 6) < 1
                        && menu.children.length === 4
                        && document.activeElement.textContent.trim() === '100%';
                    })()
                    """)));
    shell("input keyevent KEYCODE_DPAD_UP");
    shell("input keyevent KEYCODE_ENTER");
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const image = document.querySelector('[data-testid="image-A"]');
                      return document.querySelector('.stage').dataset.zoom === '6'
                        && Math.abs(image.getBoundingClientRect().width * devicePixelRatio - 12) < 0.1
                        && document.activeElement.matches('.phone-zoom-trigger')
                        && !document.querySelector('.zoom-presets:popover-open');
                    })()
                    """)));
    click(".inspection-toolbar button:first-child");
  }

  private void editPortraitLabel() throws Exception {
    eventually(
        () ->
            assertEquals(
                "true",
                js(
                    """
                    (() => {
                      const app = document.querySelector('.comparison-phone-portrait');
                      if (!app) return false;
                      const header = app.querySelector('.app-header');
                      const bounds = header.getBoundingClientRect();
                      const padding = getComputedStyle(header);
                      const m = header.querySelector('.mode-controls').getBoundingClientRect();
                      const a = header.querySelector('.header-actions').getBoundingClientRect();
                      return Math.abs(m.y + m.height / 2 - a.y - a.height / 2) < 2
                        && Math.abs(m.left - bounds.left - parseFloat(padding.paddingLeft)) < 1
                        && Math.abs(a.right - bounds.right + parseFloat(padding.paddingRight)) < 1
                        && m.y >= parseFloat(getComputedStyle(app).getPropertyValue('--comparison-safe-top'))
                        && !app.querySelector('.image-selection-bar input')
                        && !app.querySelector('.inspection-toolbar [aria-label="Keyboard shortcuts"]');
                    })()
                    """)));
    click(".header-actions [aria-label=\"Manage Images\"]");
    assertManageImagesPreviews();
    setFirstImageLabel("Portrait original");
    click(".manage-intro .phone-help");
    eventually(() -> assertEquals("2", js("document.querySelectorAll('dialog[open]').length")));
    shell("input keyevent KEYCODE_BACK");
    eventually(() -> assertEquals("1", js("document.querySelectorAll('dialog[open]').length")));
    click("dialog[open] button[aria-label=\"Close dialog\"]");
    eventually(
        () ->
            assertEquals(
                "\"Portrait original\"", js("document.querySelector('[data-testid=\"image-A\"]').alt")));
  }

  private void assertPortraitComparisonLayout() throws Exception {
    eventually(
        () -> {
          AtomicReference<JSObject> display = new AtomicReference<>();
          scenario.onActivity(a -> display.set(a.displayLayout.snapshot()));
          JSONObject panel =
              new JSONObject(
                  js(
                      """
                      (() => {
                        const panel = document.querySelector('.phone-image-controls');
                        const app = panel.closest('.app');
                        const header = app.querySelector('.app-header');
                        const stage = app.querySelector('.stage').getBoundingClientRect();
                        const appBox = app.getBoundingClientRect();
                        const panelBox = panel.getBoundingClientRect();
                        const style = getComputedStyle(panel);
                        const buttons = Array.from(panel.querySelectorAll('.phone-image-trigger, .swap-button'));
                        const close = (a, b) => Math.abs(a - b) < 1;
                        return {
                          bottom: Math.max(...buttons.map(button => button.getBoundingClientRect().bottom)),
                          appBottom: appBox.bottom,
                          dpr: devicePixelRatio,
                          roundedBottom: parseFloat(style.getPropertyValue('--phone-panel-rounded-bottom')),
                          connected: close(stage.top, header.getBoundingClientRect().bottom)
                            && close(stage.bottom, panelBox.top)
                            && [stage, panelBox].every(box => close(box.left, appBox.left) && close(box.right, appBox.right))
                            && close(panelBox.bottom, appBox.bottom - parseFloat(getComputedStyle(app).paddingBottom)),
                          frameless: style.backgroundColor === getComputedStyle(header).backgroundColor
                            && style.borderWidth === '0px' && style.borderRadius === '0px',
                          buttonsBordered: buttons.length === 3 && buttons.every(button => {
                            const border = getComputedStyle(button);
                            return border.borderTopStyle === 'solid' && parseFloat(border.borderTopWidth) > 0;
                          }),
                        };
                      })()
                      """));
          assertTrue("Header, stage and controls run edge to edge", panel.getBoolean("connected"));
          assertTrue("The panel matches the header surface", panel.getBoolean("frameless"));
          assertTrue("Individual controls retain their borders", panel.getBoolean("buttonsBordered"));
          double dpr = panel.getDouble("dpr");
          double reserved = display.get().getInteger("layoutBottom") / dpr;
          double guard = display.get().getInteger("panelGuardBottom") / dpr;
          double obstruction =
              Math.max(
                  display.get().getInteger("panelObstructionBottom") / dpr,
                  panel.optDouble(
                      "roundedBottom", display.get().getInteger("panelClearanceBottom") / dpr));
          double clearance = display.get().getInteger("height") / dpr - panel.getDouble("bottom");
          assertEquals(
              "Controls clear the native navigation area",
              Math.max(Math.max(reserved, guard), obstruction + 12),
              clearance,
              1);
          assertTrue("Controls stay outside the navigation guard", (clearance - guard) * dpr >= -0.25);
          System.out.println(
              "Portrait panel geometry: "
                  + display.get().getJSONObject("bottomInsets")
                  + ", dpr=" + dpr
                  + ", layout=" + reserved
                  + ", guard=" + guard
                  + ", obstruction=" + obstruction
                  + ", appBottom=" + panel.getDouble("appBottom")
                  + ", clearance=" + clearance);
        });
  }

  private int portraitControlGapX() throws Exception {
    return (int) Math.round(Double.parseDouble(js("""
        (() => {
          const panel = document.querySelector('.phone-image-controls');
          const a = panel.querySelector('.phone-image-trigger').getBoundingClientRect();
          const swap = panel.querySelector('.swap-button').getBoundingClientRect();
          return (a.right + swap.left) * devicePixelRatio / 2;
        })()
        """)));
  }

  private void tapPortraitControl(String label, int[] origin, JSObject display) throws Exception {
    JSONObject point =
        new JSONObject(js("""
            (() => {
              const button = document.querySelector('.phone-image-controls [aria-label="%s"]');
              const box = button.getBoundingClientRect();
              return { x: (box.left + box.right) * devicePixelRatio / 2,
                       bottom: box.bottom * devicePixelRatio };
            })()
            """.formatted(label)));
    int y = (int) Math.floor(point.getDouble("bottom")) - 2;
    int height = display.getInteger("height");
    assertTrue("Tap is inside the mandatory gesture area",
        y >= height - display.getInteger("mandatoryGestureBottom"));
    assertTrue("Tap is above the navigation bar",
        y < height - display.getInteger("panelGuardBottom"));
    shell("input tap " + (origin[0] + Math.round(point.getDouble("x"))) + " " + (origin[1] + y));
  }

  private void exercisePortraitGestures() throws Exception {
    AtomicReference<JSObject> display = new AtomicReference<>();
    int[] origin = new int[2];
    scenario.onActivity(
        a -> {
          display.set(a.displayLayout.snapshot());
          var webView = a.getBridge().getWebView();
          webView.getLocationOnScreen(origin);
          assertTrue(webView.getSystemGestureExclusionRects().isEmpty());
          assertTrue(a.getWindow().getDecorView().getSystemGestureExclusionRects().isEmpty());
        });
    int backY = origin[1] + display.get().getInteger("height") / 2;
    int backEndX = display.get().getInteger("width") / 4;
    for (String label : new String[] {"Select image A", "Select image B"}) {
      tapPortraitControl(label, origin, display.get());
      String expanded = "document.querySelector('[aria-label=\"%s\"]').getAttribute('aria-expanded')"
          .formatted(label);
      eventually(() -> assertEquals("\"true\"", js(expanded)));
      shell("input swipe %d %d %d %d 300".formatted(2, backY, backEndX, backY));
      eventually(() -> assertEquals("\"false\"", js(expanded)));
    }
    String imageA = "document.querySelector('[data-testid=\"image-A\"]').alt";
    String imageB = "document.querySelector('[data-testid=\"image-B\"]').alt";
    String originalA = js(imageA);
    tapPortraitControl("Swap images", origin, display.get());
    eventually(() -> assertEquals(originalA, js(imageB)));
    tapPortraitControl("Swap images", origin, display.get());
    eventually(() -> assertEquals(originalA, js(imageA)));
    bars(true, true);
    assertPortraitComparisonLayout();
  }

  private int tappableBottom() {
    AtomicReference<Integer> result = new AtomicReference<>();
    scenario.onActivity(
        a -> result.set(a.displayLayout.snapshot().optJSONObject("bottomInsets").optInt("tappable")));
    return result.get();
  }

  private void assertPortraitThreeButtonSurface(boolean landing) throws Exception {
    assertEquals(0, tappableBottom());
    String enable = "cmd overlay enable-exclusive --user 0 --category com.android.internal.systemui.navbar.";
    try {
      shell(enable + "threebutton");
      eventually(() -> assertTrue(tappableBottom() > 0));
      bars(true, true);
      if (landing) {
        assertLandingBrandCentered();
        screenshot("portrait-landing-three-button");
      } else {
        assertPortraitComparisonLayout();
        screenshot("portrait-three-button");
      }
    } finally {
      shell(enable + "gestural");
    }
    eventually(() -> assertEquals(0, tappableBottom()));
  }

  @Test
  public void alignmentLabelsSuppressWebViewTapHighlightInBothDialogs() throws Exception {
    seedIsolatedSession(true);
    File session = new File(InstrumentationRegistry.getInstrumentation().getTargetContext()
        .getNoBackupFilesDir(), "comparison.json");
    JSONObject unchosen = new JSONObject(new String(Files.readAllBytes(session.toPath()), StandardCharsets.UTF_8))
        .put("alignmentChoices", new JSONArray());
    Files.write(session.toPath(), unchosen.toString().getBytes(StandardCharsets.UTF_8));
    String transparentLabels = """
        (() => {
          const labels = [...document.querySelectorAll('dialog[open] .alignment-options label')];
          return labels.length === 3 && labels.every(label =>
            getComputedStyle(label).webkitTapHighlightColor === 'rgba(0, 0, 0, 0)');
        })()
        """;
    try (ActivityScenario<MainActivity> active = ActivityScenario.launch(MainActivity.class)) {
      scenario = active;
      rotate(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, false);
      eventually(() -> assertEquals("true", js(transparentLabels)));
      click("dialog button[type=submit]");
      eventually(() -> assertEquals("false", js("!!document.querySelector('dialog[open]')")));
      click("button[aria-label=\"Manage Images\"]");
      eventually(() -> assertEquals("true", js(transparentLabels)));
    }
  }

  @Test
  public void alignmentAndOriginalsSurviveActivityRecreation() throws Exception {
    seedIsolatedSession(true);
    File directory = InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir();
    File original = new File(directory, "originals/00000000-0000-4000-8000-000000000002");
    byte[] originalBytes = Files.readAllBytes(original.toPath());
    String geometry = "(() => { const a=document.querySelector('[data-testid=image-A]');"
        + " const b=document.querySelector('[data-testid=image-B]');"
        + " if(a?.naturalWidth!==320 || b?.naturalWidth!==160) return -1;"
        + " const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();"
        + " return ra.x===rb.x && ra.y===rb.y ? Math.round(rb.width / ra.width * 100) : -1; })()";
    try (ActivityScenario<MainActivity> active = ActivityScenario.launch(MainActivity.class)) {
      scenario = active;
      rotate(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, false);
      eventually(() -> assertEquals("50", js(geometry)));
      assertEquals("false", js("!!document.querySelector('dialog[open]')"));
      click("button[aria-label=\"Manage Images\"]");
      eventually(() -> assertEquals("true", js("!!document.querySelector('dialog[open] .image-alignment')")));
      click(".image-alignment input[aria-label=\"Match Width\"]");
      click("dialog button[aria-label=\"Close dialog\"]");
      eventually(() -> assertEquals("100", js(geometry)));
      eventually(() -> {
        JSONObject saved = new JSONObject(new String(
            Files.readAllBytes(new File(directory, "comparison.json").toPath()), StandardCharsets.UTF_8));
        assertEquals("width", saved.getJSONArray("alignmentChoices").getJSONObject(0).getString("mode"));
      });
      scenario.recreate();
      eventually(() -> assertEquals("100", js(geometry)));
      assertEquals("false", js("!!document.querySelector('dialog[open]')"));
      rotate(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, true);
      eventually(() -> assertEquals("100", js(geometry)));
      assertArrayEquals(originalBytes, Files.readAllBytes(original.toPath()));
    }
  }

  @Test
  public void realWindowBarsCutoutsPickerResumeBackAndRecreation() throws Exception {
    seedIsolatedSession();
    try (ActivityScenario<MainActivity> active = ActivityScenario.launch(MainActivity.class)) {
      scenario = active;
      rotate(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, false);
      eventually(() -> assertEquals("true", js("!!document.querySelector('.stage')")));
      bars(true, true);
      assertPortraitComparisonLayout();
      screenshot("portrait-normal");
      exercisePortraitGestures();
      assertPortraitThreeButtonSurface(false);
      editPortraitLabel();
      assertPortraitZoomMenu();
      click(".fullscreen-button");
      bars(false, true);
      eventually(
          () -> assertEquals("true", js("!document.querySelector('.phone-image-controls')")));
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
      click(".minimalist-exit");
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
                            + " safeTop:parseFloat(getComputedStyle(document.querySelector('.app')).getPropertyValue('--comparison-safe-top')),"
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
      click(".images-toggle");
      eventually(
          () ->
              assertEquals(
                  "true",
                  js(
                      """
                      (() => {
                        const panel = document.querySelector('.phone-images-popover:popover-open');
                        const trigger = document.querySelector('.images-toggle').getBoundingClientRect();
                        const box = panel?.getBoundingClientRect();
                        return box && Math.abs(box.top - trigger.bottom - 6) < 1
                          && box.width <= 320 && box.right <= innerWidth && box.left >= 0;
                      })()
                      """)));
      assertEquals(
          "true",
          js(
              "document.querySelectorAll('.image-selection-bar .phone-image-trigger').length === 2 && "
                  + "!document.querySelector('.image-selection-bar input, .image-selection-bar select') && "
                  + "!!document.querySelector('.image-selection-bar .swap-button')"));
      click(".phone-image-trigger");
      eventually(
          () ->
              assertEquals(
                  "true",
                  js("!!document.querySelector('.phone-image-choices:popover-open[data-open]')")));
      shell("input keyevent KEYCODE_BACK");
      eventually(
          () ->
              assertEquals(
                  "true",
                  js(
                      "!document.querySelector('.phone-image-choices:popover-open') && "
                          + "!!document.querySelector('.phone-images-popover:popover-open')")));
      shell("input keyevent KEYCODE_BACK");
      eventually(
          () ->
              assertEquals(
                  "true", js("!document.querySelector('.phone-images-popover:popover-open')")));
      click(".header-actions [aria-label=\"Manage Images\"]");
      assertManageImagesPreviews();
      setFirstImageLabel("Landscape original");
      click("dialog[open] button[aria-label=\"Close dialog\"]");
      screenshot("landscape-normal");
      click(".phone-zoom-trigger");
      eventually(
          () ->
              assertEquals(
                  "true",
                  js(
                      """
                      (() => {
                        const menu = document.querySelector('.zoom-presets:popover-open');
                        if (!menu) return false;
                        const bounds = menu.getBoundingClientRect();
                        const app = getComputedStyle(document.querySelector('.app'));
                        const safe = side => parseFloat(app.getPropertyValue('--comparison-safe-' + side));
                        return bounds.left >= safe('left') && bounds.right <= innerWidth - safe('right')
                          && bounds.top >= safe('top') && bounds.bottom <= innerHeight - safe('bottom')
                          && menu.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
                      })()
                      """)));
      shell("input keyevent KEYCODE_BACK");
      eventually(
          () -> assertEquals("true", js("!document.querySelector('.zoom-presets:popover-open')")));
      bars(false, false);
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
                      "!!document.querySelector('.comparison-minimalist"
                          + " .minimalist-exit')")));
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
                      "document.querySelector('.app').classList.contains('comparison-minimalist')")));
      assertPortraitComparisonLayout();
      assertEquals(
          "\"Landscape original\"", js("document.querySelector('[data-testid=\"image-A\"]').alt"));
      click(".header-actions [aria-label=\"Manage Images\"]");
      assertManageImagesPreviews();
      click("dialog[open] .modal-actions > button:first-child");
      eventually(
          () ->
              assertEquals(
                  "true",
                  js(
                      "!!document.querySelector('.app:not(.has-images) dialog[open] "
                          + "button[aria-label=\"Close dialog\"]:enabled')")));
      click("dialog[open] button[aria-label=\"Close dialog\"]");
      assertLandingBrandCentered();
      bars(true, true);
      screenshot("portrait-landing");
      assertPortraitThreeButtonSurface(true);
      rotate(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, true);
      bars(false, false);
      assertLandingBrandCentered();
    }
  }
}

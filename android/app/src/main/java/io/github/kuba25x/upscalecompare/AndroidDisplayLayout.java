package io.github.kuba25x.upscalecompare;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.function.Consumer;

/** The window draws edge-to-edge; only controls consume safe insets in the frontend. */
final class AndroidDisplayLayout {
  static final String STATE_KEY = "upscaleCompare.minimalist";
  static final int BACKGROUND = Color.rgb(16, 17, 20);
  private final Activity activity;
  private final View view;
  private final Consumer<JSObject> changed;
  private final View.OnLayoutChangeListener layoutListener;
  private WindowInsetsCompat insets = WindowInsetsCompat.CONSUMED;
  private boolean minimalist;
  private long revision;

  AndroidDisplayLayout(
      Activity activity, View view, boolean minimalist, Consumer<JSObject> changed) {
    this.activity = activity;
    this.view = view;
    this.minimalist = minimalist;
    this.changed = changed;
    ViewCompat.setOnApplyWindowInsetsListener(
        view,
        (v, value) -> {
          insets = value;
          publish();
          // The application uses measured CSS variables, not WebView's version-dependent safe-area
          // env.
          return new WindowInsetsCompat.Builder(value)
              .setInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                  Insets.NONE)
              .build();
        });
    layoutListener = (v, l, t, r, b, oldL, oldT, oldR, oldB) -> publish();
    view.addOnLayoutChangeListener(layoutListener);
    applyPolicy();
  }

  boolean isMinimalist() {
    return minimalist;
  }

  boolean isLandscape() {
    return activity.getResources().getConfiguration().orientation
        == Configuration.ORIENTATION_LANDSCAPE;
  }

  void setMinimalist(boolean value) {
    minimalist = value;
    applyPolicy();
  }

  @SuppressWarnings("deprecation")
  void applyPolicy() {
    Window window = activity.getWindow();
    WindowCompat.setDecorFitsSystemWindows(window, false);
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams params = window.getAttributes();
      params.layoutInDisplayCutoutMode =
          Build.VERSION.SDK_INT >= 30
              ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
              : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      window.setAttributes(params);
    }
    window.setBackgroundDrawableResource(io.github.kuba25x.upscalecompare.R.color.app_background);
    window.getDecorView().setBackgroundColor(BACKGROUND);
    // Android 15+ enforces transparency; these calls cover earlier supported versions.
    if (Build.VERSION.SDK_INT < 35) {
      window.setStatusBarColor(Color.TRANSPARENT);
      window.setNavigationBarColor(Color.TRANSPARENT);
    }
    if (Build.VERSION.SDK_INT >= 29) {
      window.setStatusBarContrastEnforced(false);
      window.setNavigationBarContrastEnforced(false);
    }
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(window, window.getDecorView());
    controller.setAppearanceLightStatusBars(false);
    controller.setAppearanceLightNavigationBars(false);
    controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    if (isLandscape() || minimalist) controller.hide(WindowInsetsCompat.Type.statusBars());
    else controller.show(WindowInsetsCompat.Type.statusBars());
    if (isLandscape()) controller.hide(WindowInsetsCompat.Type.navigationBars());
    else controller.show(WindowInsetsCompat.Type.navigationBars());
    ViewCompat.requestApplyInsets(view);
    publish();
  }

  JSObject snapshot() {
    Insets status = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars());
    Insets navigation =
        insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.navigationBars());
    Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
    Insets gestures =
        Insets.max(
            insets.getInsets(WindowInsetsCompat.Type.systemGestures()),
            insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures()));
    Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
    boolean landscape = isLandscape();
    int top = !landscape && !minimalist ? Math.max(status.top, cutout.top) : 0;
    int bottom = Math.max(landscape ? 0 : navigation.bottom, ime.bottom);
    JSArray bounds = new JSArray();
    if (insets.getDisplayCutout() != null) {
      for (android.graphics.Rect rect : insets.getDisplayCutout().getBoundingRects())
        bounds.put(
            new JSObject()
                .put("left", rect.left)
                .put("top", rect.top)
                .put("right", rect.right)
                .put("bottom", rect.bottom));
    }
    return new JSObject()
        .put("revision", revision)
        .put("minimalist", minimalist)
        .put("landscape", landscape)
        .put("width", view.getWidth())
        .put("height", view.getHeight())
        .put("statusVisible", insets.isVisible(WindowInsetsCompat.Type.statusBars()))
        .put("navigationVisible", insets.isVisible(WindowInsetsCompat.Type.navigationBars()))
        .put("layoutTop", top)
        .put("layoutBottom", bottom)
        .put("safeTop", Math.max(top, cutout.top))
        .put("safeRight", Math.max(cutout.right, Math.max(navigation.right, gestures.right)))
        .put("safeBottom", Math.max(bottom, Math.max(cutout.bottom, gestures.bottom)))
        .put("safeLeft", Math.max(cutout.left, Math.max(navigation.left, gestures.left)))
        .put("cutouts", bounds);
  }

  void publish() {
    revision++;
    changed.accept(snapshot());
  }

  void destroy() {
    ViewCompat.setOnApplyWindowInsetsListener(view, null);
    view.removeOnLayoutChangeListener(layoutListener);
  }
}

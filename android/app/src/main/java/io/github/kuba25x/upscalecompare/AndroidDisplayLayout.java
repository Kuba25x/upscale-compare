package io.github.kuba25x.upscalecompare;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.RoundedCornerCompat;
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
  private final View windowView;
  private final Consumer<JSObject> changed;
  private final View.OnLayoutChangeListener layoutListener;
  private WindowInsetsCompat insets = WindowInsetsCompat.CONSUMED;
  private boolean minimalist;
  private boolean destroyed;
  private long revision;

  AndroidDisplayLayout(
      Activity activity, View view, boolean minimalist, Consumer<JSObject> changed) {
    this.activity = activity;
    this.view = view;
    this.windowView = activity.getWindow().getDecorView();
    this.minimalist = minimalist;
    this.changed = changed;
    ViewCompat.setOnApplyWindowInsetsListener(
        windowView,
        (v, value) -> {
          v.setPadding(0, 0, 0, 0);
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
    if (destroyed || activity.isFinishing()) return;
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
    ViewCompat.requestApplyInsets(windowView);
    publish();
  }

  JSObject snapshot() {
    Insets status = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars());
    Insets navigation =
        insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.navigationBars());
    Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
    Insets mandatory = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures());
    Insets systemGestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures());
    Insets gestures = Insets.max(systemGestures, mandatory);
    Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
    boolean landscape = isLandscape();
    int top = !landscape && !minimalist ? Math.max(status.top, cutout.top) : 0;
    int bottom = Math.max(landscape ? 0 : navigation.bottom, ime.bottom);
    int safeLeft = Math.max(cutout.left, Math.max(navigation.left, gestures.left));
    int safeRight = Math.max(cutout.right, Math.max(navigation.right, gestures.right));
    int visibleNavigation = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
    int mandatoryBottom =
        Math.max(
            mandatory.bottom,
            insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.mandatorySystemGestures())
                .bottom);
    int tappable = WindowInsetsCompat.Type.tappableElement();
    int visibleTappable = insets.getInsets(tappable).bottom;
    int stableTappable = insets.getInsetsIgnoringVisibility(tappable).bottom;
    int tappableBottom = Math.max(visibleTappable, stableTappable);
    RoundedCornerCompat leftCorner =
        insets.getRoundedCorner(RoundedCornerCompat.POSITION_BOTTOM_LEFT);
    RoundedCornerCompat rightCorner =
        insets.getRoundedCorner(RoundedCornerCompat.POSITION_BOTTOM_RIGHT);
    int roundedBottom =
        Math.max(
            cornerBottom(leftCorner, safeLeft, true),
            cornerBottom(rightCorner, windowView.getWidth() - safeRight, false));
    int panelSafeBottom = Math.max(cutout.bottom, roundedBottom);
    int navigationGuard = Math.max(navigation.bottom, visibleNavigation);
    // A gesture-only bar needs clearance for the handle and mandatory swipes. The extra visual
    // gap belongs above obstructions, including button navigation, the IME and display edges.
    boolean reportsControlInsets =
        Build.VERSION.SDK_INT >= 30 && (tappableBottom > 0 || mandatoryBottom > 0);
    int navigationObstruction =
        reportsControlInsets ? tappableBottom : Math.max(navigationGuard, tappableBottom);
    int panelObstructionBottom = Math.max(navigationObstruction, Math.max(ime.bottom, cutout.bottom));
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
        // Hidden status bars retain a mandatory swipe-start inset. Reserving it for
        // tap controls would recreate the empty status-bar strip in landscape.
        // System edge swipes remain available; the app requests no gesture exclusions.
        .put("safeTop", Math.max(top, cutout.top))
        .put("safeRight", safeRight)
        .put("safeBottom", Math.max(bottom, Math.max(cutout.bottom, gestures.bottom)))
        .put("safeLeft", safeLeft)
        .put("panelSafeBottom", panelSafeBottom)
        .put("mandatoryGestureBottom", mandatoryBottom)
        .put("panelGuardBottom", Math.max(navigationGuard, mandatoryBottom))
        .put("panelClearanceBottom", Math.max(panelObstructionBottom, panelSafeBottom))
        .put("panelObstructionBottom", panelObstructionBottom)
        .put("panelRoundedCorners", panelRoundedCorners(leftCorner, rightCorner))
        .put(
            "bottomInsets",
            new JSObject()
                .put("navigation", visibleNavigation)
                .put("stableNavigation", navigation.bottom)
                .put("tappable", visibleTappable)
                .put("stableTappable", stableTappable)
                .put("systemGestures", systemGestures.bottom)
                .put("mandatoryGestures", mandatoryBottom)
                .put("ime", ime.bottom)
                .put("cutout", cutout.bottom)
                .put("roundedCorners", roundedBottom))
        .put("cutouts", bounds);
  }

  private JSObject panelRoundedCorners(RoundedCornerCompat left, RoundedCornerCompat right) {
    JSObject corners = new JSObject();
    if (left == null && right == null) return corners;
    int[] viewOrigin = new int[2];
    view.getLocationInWindow(viewOrigin);
    if (left != null) corners.put("left", viewCorner(left, viewOrigin));
    if (right != null) corners.put("right", viewCorner(right, viewOrigin));
    return corners;
  }

  private JSObject viewCorner(RoundedCornerCompat corner, int[] viewOrigin) {
    return new JSObject()
        .put("x", corner.getCenterX() - viewOrigin[0])
        .put("y", corner.getCenterY() - viewOrigin[1])
        .put("radius", corner.getRadius());
  }

  // Keep the side-inset estimate until the WebView can measure the actual controls.
  private int cornerBottom(RoundedCornerCompat corner, int x, boolean left) {
    if (corner == null) return 0;
    double distance = left ? corner.getCenterX() - x : x - corner.getCenterX();
    if (distance <= 0) return 0;
    double radius = corner.getRadius();
    double arc = Math.sqrt(Math.max(0, radius * radius - distance * distance));
    return Math.max(0, (int) Math.ceil(windowView.getHeight() - corner.getCenterY() - arc));
  }

  void publish() {
    if (destroyed) return;
    revision++;
    changed.accept(snapshot());
  }

  void destroy() {
    destroyed = true;
    ViewCompat.setOnApplyWindowInsetsListener(windowView, null);
    view.removeOnLayoutChangeListener(layoutListener);
  }
}

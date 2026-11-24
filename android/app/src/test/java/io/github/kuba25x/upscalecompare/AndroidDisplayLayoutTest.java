package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.DisplayCutoutCompat;
import androidx.core.view.RoundedCornerCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class AndroidDisplayLayoutTest {
  @Test
  public void portraitLayoutConsumesBarsButMinimalistConsumesOnlyNavigation() {
    var controller = Robolectric.buildActivity(Activity.class).setup();
    Activity activity = controller.get();
    View view = new View(activity);
    activity.setContentView(view);
    var layout = new AndroidDisplayLayout(activity, view, false, state -> {});
    WindowInsetsCompat insets =
        new WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, 90, 0, 0))
            .setInsetsIgnoringVisibility(
                WindowInsetsCompat.Type.statusBars(), Insets.of(0, 90, 0, 0))
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, 60))
            .setInsetsIgnoringVisibility(
                WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, 60))
            .setDisplayCutout(
                new DisplayCutoutCompat(
                    new Rect(0, 100, 0, 0), List.of(new Rect(180, 0, 220, 100))))
            .build();
    ViewCompat.dispatchApplyWindowInsets(activity.getWindow().getDecorView(), insets);
    assertEquals(100, layout.snapshot().getInteger("layoutTop").intValue());
    assertEquals(60, layout.snapshot().getInteger("layoutBottom").intValue());
    layout.setMinimalist(true);
    assertEquals(0, layout.snapshot().getInteger("layoutTop").intValue());
    assertEquals(100, layout.snapshot().getInteger("safeTop").intValue());
    assertEquals(60, layout.snapshot().getInteger("layoutBottom").intValue());
    assertEquals(0, view.getPaddingTop());
    assertEquals(
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS,
        activity.getWindow().getAttributes().layoutInDisplayCutoutMode);
    assertFalse(
        WindowCompat.getInsetsController(activity.getWindow(), view).isAppearanceLightStatusBars());
    assertFalse(activity.getWindow().isNavigationBarContrastEnforced());
    layout.destroy();
    controller.pause().stop().destroy();
  }

  @Test
  public void portraitPanelUsesRoundedEdgesAndStableNavigationAndGestureInsets() {
    var controller = Robolectric.buildActivity(Activity.class).setup();
    Activity activity = controller.get();
    View view = new View(activity);
    activity.setContentView(view);
    View decor = activity.getWindow().getDecorView();
    decor.layout(0, 0, 300, 600);
    var layout = new AndroidDisplayLayout(activity, view, false, state -> {});
    int navigation = WindowInsetsCompat.Type.navigationBars();
    int mandatory = WindowInsetsCompat.Type.mandatorySystemGestures();
    for (boolean visible : new boolean[] {false, true, false}) {
      var insets =
          new WindowInsetsCompat.Builder()
              .setVisible(navigation, visible)
              .setInsets(navigation, Insets.of(0, 0, 0, visible ? 24 : 0))
              .setInsetsIgnoringVisibility(navigation, Insets.of(0, 0, 0, 24))
              .setInsets(WindowInsetsCompat.Type.systemGestures(), Insets.of(20, 0, 25, 70))
              .setInsets(mandatory, Insets.of(0, 0, 0, visible ? 30 : 0))
              .setInsetsIgnoringVisibility(mandatory, Insets.of(0, 0, 0, 30))
              .setRoundedCorner(
                  RoundedCornerCompat.POSITION_BOTTOM_LEFT,
                  new RoundedCornerCompat(RoundedCornerCompat.POSITION_BOTTOM_LEFT, 80, 80, 520))
              .setRoundedCorner(
                  RoundedCornerCompat.POSITION_BOTTOM_RIGHT,
                  new RoundedCornerCompat(RoundedCornerCompat.POSITION_BOTTOM_RIGHT, 100, 200, 500))
              .build();
      ViewCompat.dispatchApplyWindowInsets(decor, insets);
      JSObject state = layout.snapshot();
      assertEquals(24, state.getInteger("layoutBottom").intValue());
      assertEquals(70, state.getInteger("safeBottom").intValue());
      assertEquals(30, state.getInteger("mandatoryGestureBottom").intValue());
      assertEquals(34, state.getInteger("panelSafeBottom").intValue());
      assertEquals(24, state.getInteger("panelGuardBottom").intValue());
      assertEquals(34, state.getInteger("panelClearanceBottom").intValue());
      assertEquals(0, state.getInteger("panelObstructionBottom").intValue());
      int[] origin = new int[2];
      view.getLocationInWindow(origin);
      var corners = state.optJSONObject("panelRoundedCorners");
      var leftCorner = corners.optJSONObject("left");
      var rightCorner = corners.optJSONObject("right");
      assertEquals(80, leftCorner.optInt("radius"));
      assertEquals(80 - origin[0], leftCorner.optInt("x"));
      assertEquals(520 - origin[1], leftCorner.optInt("y"));
      assertEquals(100, rightCorner.optInt("radius"));
      assertEquals(200 - origin[0], rightCorner.optInt("x"));
      assertEquals(500 - origin[1], rightCorner.optInt("y"));
    }
    layout.destroy();
    controller.pause().stop().destroy();
  }

  @Test
  public void portraitPanelAdaptsToTheReportedNavigationModeAndIme() {
    var controller = Robolectric.buildActivity(Activity.class).setup();
    Activity activity = controller.get();
    View view = new View(activity);
    activity.setContentView(view);
    View decor = activity.getWindow().getDecorView();
    var layout = new AndroidDisplayLayout(activity, view, false, state -> {});
    int navigation = WindowInsetsCompat.Type.navigationBars();
    int tappable = WindowInsetsCompat.Type.tappableElement();
    int mandatory = WindowInsetsCompat.Type.mandatorySystemGestures();
    int ime = WindowInsetsCompat.Type.ime();
    for (int buttonInset : new int[] {0, 60, 0}) {
      for (boolean visible : new boolean[] {true, false, true}) {
        var builder =
            new WindowInsetsCompat.Builder()
                .setVisible(navigation, visible)
                .setInsets(navigation, Insets.of(0, 0, 0, visible ? 60 : 0))
                .setInsetsIgnoringVisibility(navigation, Insets.of(0, 0, 0, 60))
                .setInsets(tappable, Insets.of(0, 0, 0, visible ? buttonInset : 0))
                .setInsetsIgnoringVisibility(tappable, Insets.of(0, 0, 0, buttonInset))
                .setInsetsIgnoringVisibility(mandatory, Insets.of(0, 0, 0, 90));
        var withoutIme = builder.build();
        ViewCompat.dispatchApplyWindowInsets(decor, withoutIme);
        JSObject state = layout.snapshot();
        assertEquals(60, state.getInteger("layoutBottom").intValue());
        assertEquals(buttonInset == 0 ? 60 : 90, state.getInteger("panelGuardBottom").intValue());
        assertEquals(buttonInset, state.getInteger("panelClearanceBottom").intValue());
        assertEquals(buttonInset, state.getInteger("panelObstructionBottom").intValue());

        ViewCompat.dispatchApplyWindowInsets(
            decor, builder.setInsets(ime, Insets.of(0, 0, 0, 300)).build());
        assertEquals(300, layout.snapshot().getInteger("panelClearanceBottom").intValue());
        assertEquals(300, layout.snapshot().getInteger("panelObstructionBottom").intValue());
        ViewCompat.dispatchApplyWindowInsets(decor, withoutIme);
        assertEquals(buttonInset, layout.snapshot().getInteger("panelClearanceBottom").intValue());
      }
    }
    layout.destroy();
    controller.pause().stop().destroy();
  }

  @Test
  public void portraitPanelKeepsTheConservativeGuardWhenNavigationInsetsAreUnreliable() {
    var controller = Robolectric.buildActivity(Activity.class).setup();
    Activity activity = controller.get();
    View view = new View(activity);
    activity.setContentView(view);
    View decor = activity.getWindow().getDecorView();
    var layout = new AndroidDisplayLayout(activity, view, false, state -> {});
    int navigation = WindowInsetsCompat.Type.navigationBars();
    int mandatory = WindowInsetsCompat.Type.mandatorySystemGestures();
    var insets =
        new WindowInsetsCompat.Builder()
            .setVisible(navigation, true)
            .setInsetsIgnoringVisibility(mandatory, Insets.of(0, 0, 0, 90));
    ViewCompat.dispatchApplyWindowInsets(decor, insets.build());
    assertEquals(90, layout.snapshot().getInteger("panelGuardBottom").intValue());
    ViewCompat.dispatchApplyWindowInsets(
        decor, insets.setInsetsIgnoringVisibility(navigation, Insets.of(0, 0, 0, 60)).build());
    assertEquals(90, layout.snapshot().getInteger("panelGuardBottom").intValue());
    ViewCompat.dispatchApplyWindowInsets(
        decor,
        insets.setInsets(navigation, Insets.of(0, 0, 0, 60))
            .setInsetsIgnoringVisibility(mandatory, Insets.NONE)
            .build());
    assertEquals(60, layout.snapshot().getInteger("panelClearanceBottom").intValue());
    layout.destroy();
    controller.pause().stop().destroy();
  }

  @Test
  public void eitherLandscapeCutoutProtectsControlsWithoutPaddingTheImageSurface() {
    var controller = Robolectric.buildActivity(Activity.class).setup();
    Activity activity = controller.get();
    Configuration config = new Configuration(activity.getResources().getConfiguration());
    config.orientation = Configuration.ORIENTATION_LANDSCAPE;
    activity
        .getResources()
        .updateConfiguration(config, activity.getResources().getDisplayMetrics());
    View view = new View(activity);
    activity.setContentView(view);
    var layout = new AndroidDisplayLayout(activity, view, false, state -> {});
    for (boolean left : new boolean[] {true, false}) {
      WindowInsetsCompat insets =
          new WindowInsetsCompat.Builder()
              .setInsets(WindowInsetsCompat.Type.systemGestures(), Insets.of(20, 0, 20, 24))
              .setInsets(WindowInsetsCompat.Type.mandatorySystemGestures(), Insets.of(0, 90, 0, 24))
              .setDisplayCutout(
                  new DisplayCutoutCompat(
                      new Rect(left ? 96 : 0, 0, left ? 0 : 96, 0),
                      List.of(new Rect(left ? 0 : 900, 180, left ? 96 : 996, 220))))
              .build();
      ViewCompat.dispatchApplyWindowInsets(activity.getWindow().getDecorView(), insets);
      for (boolean minimalist : new boolean[] {false, true}) {
        layout.setMinimalist(minimalist);
        JSObject state = layout.snapshot();
        assertTrue(state.getBool("landscape"));
        assertEquals(0, state.getInteger("layoutTop").intValue());
        assertEquals(0, state.getInteger("safeTop").intValue());
        assertEquals(0, state.getInteger("layoutBottom").intValue());
        assertEquals(96, state.getInteger(left ? "safeLeft" : "safeRight").intValue());
        assertEquals(20, state.getInteger(left ? "safeRight" : "safeLeft").intValue());
        assertEquals(1, state.optJSONArray("cutouts").length());
        assertEquals(0, view.getPaddingLeft());
        assertEquals(0, view.getPaddingRight());
      }
    }
    // Keyboard space remains usable for the expanded label editor even in landscape.
    ViewCompat.dispatchApplyWindowInsets(
        activity.getWindow().getDecorView(),
        new WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 300))
            .build());
    assertEquals(300, layout.snapshot().getInteger("layoutBottom").intValue());
    layout.destroy();
    controller.pause().stop().destroy();
  }
}

package io.github.kuba25x.upscalecompare;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.DisplayCutoutCompat;
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

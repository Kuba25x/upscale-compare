package io.github.kuba25x.upscalecompare;

import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
  AndroidDisplayLayout displayLayout;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OriginalsPlugin.class);
    registerPlugin(DisplayLayoutPlugin.class);
    super.onCreate(savedInstanceState);
    if (bridge == null) return;
    displayLayout =
        new AndroidDisplayLayout(
            this,
            bridge.getWebView(),
            savedInstanceState != null
                && savedInstanceState.getBoolean(AndroidDisplayLayout.STATE_KEY),
            state ->
                ((DisplayLayoutPlugin) bridge.getPlugin("DisplayLayout").getInstance())
                    .changed(state));
    bridge.addWebViewListener(
        new WebViewListener() {
          @Override
          public void onPageCommitVisible(android.webkit.WebView view, String url) {
            displayLayout.applyPolicy();
          }
        });
    // Run after Capacitor's initial SystemBars setup, which is queued on the UI thread.
    bridge.getWebView().post(() -> displayLayout.applyPolicy());
  }

  @Override
  public void onConfigurationChanged(Configuration config) {
    super.onConfigurationChanged(config);
    if (displayLayout != null) displayLayout.applyPolicy();
  }

  @Override
  public void onResume() {
    super.onResume();
    if (displayLayout != null) displayLayout.applyPolicy();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus && displayLayout != null) displayLayout.applyPolicy();
  }

  @Override
  public void onSaveInstanceState(Bundle state) {
    if (displayLayout != null)
      state.putBoolean(AndroidDisplayLayout.STATE_KEY, displayLayout.isMinimalist());
    super.onSaveInstanceState(state);
  }

  @Override
  public void onDestroy() {
    if (displayLayout != null) displayLayout.destroy();
    super.onDestroy();
  }
}

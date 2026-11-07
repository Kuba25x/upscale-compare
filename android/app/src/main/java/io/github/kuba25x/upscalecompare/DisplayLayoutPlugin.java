package io.github.kuba25x.upscalecompare;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DisplayLayout")
public class DisplayLayoutPlugin extends Plugin {
  @PluginMethod
  public void getState(PluginCall call) {
    getActivity().runOnUiThread(() -> call.resolve(layout().snapshot()));
  }

  @PluginMethod
  public void setMode(PluginCall call) {
    boolean minimalist = call.getBoolean("minimalist", false);
    getActivity()
        .runOnUiThread(
            () -> {
              layout().setMinimalist(minimalist);
              call.resolve(layout().snapshot());
            });
  }

  private AndroidDisplayLayout layout() {
    return ((MainActivity) getActivity()).displayLayout;
  }

  void changed(JSObject state) {
    notifyListeners("layoutChange", state, true);
  }
}

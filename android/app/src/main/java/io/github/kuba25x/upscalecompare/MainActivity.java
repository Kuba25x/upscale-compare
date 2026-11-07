package io.github.kuba25x.upscalecompare;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(OriginalsPlugin.class);
    super.onCreate(savedInstanceState);
  }
}

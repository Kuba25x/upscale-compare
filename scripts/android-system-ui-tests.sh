#!/usr/bin/env bash
set -euo pipefail

adb shell cmd overlay enable --user 0 com.android.internal.display.cutout.emulation.tall
adb shell cmd overlay enable --user 0 com.android.internal.systemui.navbar.gestural
display_test_exit=0
./android/gradlew -p android --no-daemon connectedSystemUiAndroidTest || display_test_exit=$?
mkdir -p test-results/native-system-ui
adb pull /data/local/tmp/upscale-compare-system-ui test-results/native-system-ui || true
exit "$display_test_exit"

#!/usr/bin/env bash
set -euo pipefail

DEVICE="${1:-}"  # optional: ip:port or device serial
APK="app/build/outputs/apk/debug/app-debug.apk"

if [ -n "${DEVICE}" ]; then
  ADB=(adb -s "${DEVICE}")
else
  ADB=(adb)
fi

if [ ! -f "${APK}" ]; then
  echo "[!] APK not found at ${APK}. Build it first (scripts/build_vr_debug.sh)."
  exit 1
fi

echo "[+] Installing ${APK}"
"${ADB[@]}" install -r "${APK}"

echo "[+] Launching VRSpatialActivity"
"${ADB[@]}" shell am start -n com.openipc.pixelpilot/.VRSpatialActivity || {
  echo "[!] VRSpatialActivity not found in installed APK."
  exit 1
}

echo "[+] Launched. Capturing recent logs..."
"${ADB[@]}" shell logcat -d | grep -E "pixelpilot|WfbNgVpnService|Wfbng|Mavlink|VideoPlayer" | tail -n 200 || true


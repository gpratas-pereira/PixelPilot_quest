#!/usr/bin/env bash
set -euo pipefail

# Builds a debug APK for arm64-v8a using the local ./android-sdk if present.

SDK_ROOT_DEFAULT="$(pwd)/android-sdk"
if [ -d "${SDK_ROOT_DEFAULT}" ]; then
  export ANDROID_SDK_ROOT="${SDK_ROOT_DEFAULT}"
  export ANDROID_HOME="${SDK_ROOT_DEFAULT}"
  export PATH="${ANDROID_SDK_ROOT}/platform-tools:${PATH}"
fi

echo "[+] Gradle version"
./gradlew --version

echo "[+] Building debug APK (arm64-v8a)"
./gradlew assembleDebug -Pandroid.injected.build.abi=arm64-v8a

APK="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "${APK}" ]; then
  echo "[+] APK built: ${APK}"
else
  echo "[!] APK not found. Build may have failed earlier."
  exit 1
fi


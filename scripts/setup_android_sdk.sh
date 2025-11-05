#!/usr/bin/env bash
set -euo pipefail

# Installs a local Android SDK into ./android-sdk and accepts licenses.
# Requires: bash, curl, unzip, JDK 11+ on PATH.

SDK_ROOT="$(pwd)/android-sdk"
CMDLINE_VER="11076708"
URL="https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_VER}_latest.zip"

echo "[+] Creating SDK root at ${SDK_ROOT}"
mkdir -p "${SDK_ROOT}/cmdline-tools"
cd "${SDK_ROOT}/cmdline-tools"

if [ ! -d "latest" ]; then
  echo "[+] Downloading commandline-tools..."
  curl -L -o cmdline-tools.zip "${URL}"
  unzip -q cmdline-tools.zip
  rm -f cmdline-tools.zip
  mkdir -p latest
  mv cmdline-tools/* latest/
  rmdir cmdline-tools || true
fi

export ANDROID_SDK_ROOT="${SDK_ROOT}"
export ANDROID_HOME="${SDK_ROOT}"
export PATH="${SDK_ROOT}/cmdline-tools/latest/bin:${SDK_ROOT}/platform-tools:${PATH}"

echo "[+] Accepting licenses..."
yes | sdkmanager --licenses > /dev/null || true

echo "[+] Installing required packages..."
sdkmanager \
  "platform-tools" \
  "platforms;android-34" \
  "build-tools;35.0.0" \
  "cmake;3.22.1" \
  "ndk;26.1.10909125"

echo "[+] SDK ready at ${SDK_ROOT}"


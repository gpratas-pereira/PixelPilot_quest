#!/bin/bash

# PixelPilot Quest 3 Build Script
# This script builds and deploys PixelPilot for Meta Quest 3 with VR immersive features

set -e

echo "🚁 Building PixelPilot for Meta Quest 3..."

# Set up custom JDK path
export JAVA_HOME="/home/gpratas/repos/PixelPilot_quest/jdk-17.0.13+11"
export PATH="$JAVA_HOME/bin:$PATH"

# Check if custom JDK is available
if [ ! -f "$JAVA_HOME/bin/javac" ]; then
    echo "❌ Custom JDK not found at $JAVA_HOME"
    echo "💡 Make sure the OpenJDK 17 is properly extracted."
    exit 1
fi

echo "✅ Using custom OpenJDK 17: $(java -version 2>&1 | head -n 1)"

# Check if Android SDK is available
if [ -z "$ANDROID_HOME" ]; then
    echo "❌ ANDROID_HOME not set. Please set your Android SDK path."
    echo "💡 Common Android SDK paths:"
    echo "   - Windows: export ANDROID_HOME=/mnt/c/Users/\$USER/AppData/Local/Android/Sdk"
    echo "   - Linux: export ANDROID_HOME=\$HOME/Android/Sdk"
    echo "   - Or use: export ANDROID_HOME=\$(dirname \$(dirname \$(which adb)))"
    echo ""
    echo "🔧 To set temporarily: export ANDROID_HOME=/path/to/android/sdk"
    echo "🔧 To set permanently: echo 'export ANDROID_HOME=/path/to/android/sdk' >> ~/.bashrc"
    exit 1
fi

# Check if device is connected
echo "📱 Checking for connected Quest device..."
if ! adb devices | grep -q "device$"; then
    echo "❌ No Quest device found. Please connect your Quest 3 and enable developer mode."
    echo "💡 Make sure USB debugging is enabled in Quest developer settings."
    exit 1
fi

echo "✅ Quest device detected"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
./gradlew clean

# Build debug APK optimized for Quest 3
echo "🔨 Building PixelPilot VR for Quest 3..."
./gradlew assembleDebug -Pandroid.injected.build.abi=arm64-v8a

# Check if build was successful
if [ ! -f "app/build/outputs/apk/debug/app-debug.apk" ]; then
    echo "❌ Build failed - APK not found"
    exit 1
fi

echo "✅ Build successful!"

# Install on Quest device
echo "📲 Installing PixelPilot VR on Quest 3..."
adb install -r app/build/outputs/apk/debug/app-debug.apk

if [ $? -eq 0 ]; then
    echo "✅ Installation successful!"
    echo ""
    echo "🥽 PixelPilot VR is now installed on your Quest 3!"
    echo ""
    echo "📋 Usage Instructions:"
    echo "   1. Put on your Quest 3 headset"
    echo "   2. Find 'PixelPilot' in your app library"
    echo "   3. Launch the app in normal mode for traditional UI"
    echo "   4. In the app, go to Settings > VR mode > Launch Immersive VR"
    echo "   5. Or launch directly from Quest home as a VR app"
    echo ""
    echo "🎮 VR Controls:"
    echo "   • Use hand tracking to interact with panels"
    echo "   • Point and pinch to select options"
    echo "   • Use controllers for precise input"
    echo "   • Trigger button: Toggle recording"
    echo "   • Menu button: Show/hide control panel"
    echo ""
    echo "⚠️  Important Notes:"
    echo "   • Ensure your drone's WFB-NG system is compatible"
    echo "   • Connect USB WiFi adapter for optimal performance"
    echo "   • Adjust IPD and screen distance in VR settings"
    echo ""
    echo "🔧 If you experience issues:"
    echo "   • Check Quest developer mode is enabled"
    echo "   • Verify USB debugging permissions"
    echo "   • Ensure Quest 3 firmware is up to date"
    echo "   • Try restarting the Quest if VR mode doesn't work"
    echo "   • JDK issues: This script uses custom OpenJDK 17 from jdk-17.0.13+11/"
    echo "   • Android Studio: Use WSL path \\\\wsl.localhost\\kali-linux\\$PWD for opening project"
else
    echo "❌ Installation failed"
    exit 1
fi

# Optional: Launch the app automatically
read -p "🚀 Launch PixelPilot now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚁 Launching PixelPilot..."
    adb shell am start -n com.openipc.pixelpilot/.VideoActivity
    echo "✅ App launched! Check your Quest 3 headset."
fi

echo ""
echo "🎉 PixelPilot VR setup complete!"
echo "Happy flying! 🚁✨"
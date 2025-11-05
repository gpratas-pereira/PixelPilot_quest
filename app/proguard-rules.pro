-keep class com.openipc.mavlink.MavlinkData { *; }
-keep interface com.openipc.mavlink.MavlinkUpdate { *; }
-keep class * implements com.openipc.mavlink.MavlinkUpdate { *; }
-keep class com.openipc.mavlink.MavlinkNative { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# Keep VR UI Manager classes to prevent ClassNotFoundException
-keep class com.openipc.pixelpilot.vr.ui.VRUIManager { *; }
-keep class com.openipc.pixelpilot.vr.ui.VRQuadPanel { *; }
-keep class com.openipc.pixelpilot.vr.ui.VRTextRenderer { *; }
-keep class com.openipc.pixelpilot.OpenXrNativeActivity { *; }
-keepclassmembers class com.openipc.pixelpilot.OpenXrNativeActivity {
    public void initializeVRUIManager();
    public static native void nativeUpdateUI(...);
    public static native void nativeRenderUI(...);
    public static native void nativeInitializeUI();
    public static native void nativeDisposeUI();
}

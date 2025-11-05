package com.openipc.pixelpilot;

import android.app.NativeActivity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.KeyEvent;
import android.view.WindowManager;

import com.openipc.videonative.VideoPlayer;
import com.openipc.videonative.VideoPlayerHolder;
import com.openipc.videonative.IVideoParamsChanged;
import com.openipc.videonative.DecodingInfo;
import com.openipc.pixelpilot.vr.ui.VRUIManager;
import com.openipc.mavlink.MavlinkData;
import com.openipc.mavlink.MavlinkNative;
import com.openipc.mavlink.MavlinkUpdate;
import com.openipc.pixelpilot.WfbNgVpnService;

import java.util.Locale;

public class OpenXrNativeActivity extends NativeActivity implements IVideoParamsChanged {
    static {
        System.loadLibrary("openxr_app");
    }

    private static final String TAG = "pixelpilot";
    private Handler handler;
    private static WifiManager wifiManager;
    private VideoPlayer videoPlayer;
    private VRUIManager vrUIManager;
    private int lastVideoWidth;
    private int lastVideoHeight;
    private float lastFpsValue;
    private float lastBitrateKbps;
    private boolean hasDecodingStats;
    private BroadcastReceiver batteryReceiver;
    private boolean backendConnected = false;
    private String backendDeviceId = "";
    private String backendDisplayMode = "";
    private boolean backendSessionActive = false;
    private String backendSessionRemaining = "";
    private int backendSessionSeconds = 0;
    private int backendBatteryLevel = -1;
    private boolean backendBatteryCharging = false;
    private String backendWifiChannelOverride = "";
    private int lastReportedBackendChannel = -1;
    private boolean initialChannelReported = false;
    private int qualityTier = 1;
    private int enhancementMode = 1;
    private float enhancementStrength = 0.6f;
    private final Object startLineLock = new Object();
    private String startLineStatus = "idle";
    private long startLineArmedAtMs = 0L;
    private long startLineCountdownAtMs = 0L;
    private int startLineStepIntervalMs = 1000;
    private int startLineLedCount = DEFAULT_START_LINE_LED_COUNT;
    private boolean startLineGoSoundPlayed = false;
    private ToneGenerator startLineToneGenerator;
    private static final int DEFAULT_START_LINE_LED_COUNT = 5;
    

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Log.d(TAG, "OpenXrNativeActivity lifecycle onCreate");
        super.onCreate(savedInstanceState);

        // Stop any running VPN service to prevent conflicts in VR mode
        stopVpnService();

        // Basic UI setup like VideoActivity
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);

        wifiManager = (WifiManager) getSystemService(Context.WIFI_SERVICE);

        // Initialize WFB-NG like VideoActivity does
        initializeWfbNg();

        // Initialize video player like VideoActivity does
        initializeVideoPlayers();

        // Setup Mavlink like VideoActivity does
        setupMavlink();

        // Setup battery receiver like VideoActivity does
        setupBatteryReceiver();

        // Start VPN service like VideoActivity does
        startVpnService();

        startLineToneGenerator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80);
        vrUIManager = new VRUIManager(this);
        Log.d(TAG, "VRUIManager instance created");
        captureInitialWifiChannel();
        pushVrUiUpdate();
        updateNativeTexelScale();
        nativeSetEnhancementParameters(enhancementMode, enhancementStrength);
        nativeSetQualityTier(qualityTier);
        nativeSetDisplaySurfaceMode(1);

        Log.d(TAG, "OpenXrNativeActivity initialization completed");
    }

    @Override
    protected void onResume() {
        Log.d(TAG, "OpenXrNativeActivity lifecycle onResume");
        super.onResume();

        if (handler != null) {
            handler.postDelayed(mavlinkRunnable, 100);
        }

        pushVrUiUpdate();
    }

    @Override
    protected void onPause() {
        Log.d(TAG, "OpenXrNativeActivity lifecycle onPause");
        super.onPause();

        if (handler != null) {
            handler.removeCallbacks(mavlinkRunnable);
        }
    }

    @Override
    protected void onDestroy() {
        Log.d(TAG, "OpenXrNativeActivity lifecycle onDestroy");
        super.onDestroy();

        if (startLineToneGenerator != null) {
            startLineToneGenerator.release();
            startLineToneGenerator = null;
        }

        VideoPlayerHolder.setInstance(null);

        if (handler != null) {
            handler.removeCallbacks(mavlinkRunnable);
            handler = null;
        }

        if (batteryReceiver != null) {
            try {
                unregisterReceiver(batteryReceiver);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unregister battery receiver", e);
            }
            batteryReceiver = null;
        }

        if (vrUIManager != null) {
            try {
                vrUIManager.dispose();
            } catch (Exception e) {
                Log.w(TAG, "Failed to dispose VRUIManager cleanly", e);
            }
            vrUIManager = null;
            lastVideoWidth = 0;
            lastVideoHeight = 0;
            lastFpsValue = 0f;
            lastBitrateKbps = 0f;
            hasDecodingStats = false;
        }
    }

    private final Runnable mavlinkRunnable = new Runnable() {
        public void run() {
            try {
                // Create a simple implementation of MavlinkUpdate
                MavlinkUpdate callback = new MavlinkUpdate() {
                    @Override
                    public void onNewMavlinkData(MavlinkData data) {
                        // Handle mavlink data - for now just log
                        Log.d(TAG, "Received mavlink data: " + data.toString());
                    }
                };
                MavlinkNative.nativeCallBack(callback);
                if (handler != null) {
                    handler.postDelayed(this, 100);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in Mavlink callback", e);
            }
        }
    };
    /**
     * Stops VPN service like VideoActivity.stopVpnService()
     * This ensures no VPN service is running when OpenXR starts
     */
    private void stopVpnService() {
        Log.d(TAG, "OpenXrNativeActivity stopping VPN service");
        try {
            Intent vpnIntent = new Intent(this, WfbNgVpnService.class);
            vpnIntent.setAction("STOP_SERVICE");
            startService(vpnIntent);
            Log.d(TAG, "OpenXrNativeActivity VPN service stop signal sent");
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop VPN service", e);
        }
    }

    /**
     * Starts VPN service like VideoActivity.startVpnService()
     * This ensures VPN connectivity is available for WFB-NG in VR mode
     */
    private void startVpnService() {
        Log.d(TAG, "OpenXrNativeActivity starting VPN service");
        try {
            // Prepare VPN service (required for Android VPN API)
            Intent intent = android.net.VpnService.prepare(this);
            if (intent != null) {
                // VPN permission not yet granted, but since this is NativeActivity
                // we can't easily handle the permission request
                Log.w(TAG, "VPN permission not granted - VPN may not work in VR mode");
            } else {
                // Permission already granted, start the VPN service
                Intent serviceIntent = new Intent(this, WfbNgVpnService.class);
                try {
                    startService(serviceIntent);
                    Log.d(TAG, "OpenXrNativeActivity VPN service started");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start VPN service", e);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to prepare/start VPN service", e);
        }
    }

    /**
     * Initializes WFB-NG like VideoActivity.initializeWfbNg()
     */
    private void initializeWfbNg() {
        Log.d(TAG, "OpenXrNativeActivity initializing WFB-NG");
        try {
            setDefaultGsKey();
            copyGSKey();
            Log.d(TAG, "OpenXrNativeActivity WFB-NG initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize WFB-NG", e);
        }
    }

    /**
     * Initializes VideoPlayer like VideoActivity.initializeVideoPlayers()
     * Note: NativeActivity can create VideoPlayer instance for VR mode
     */
    private void initializeVideoPlayers() {
        Log.d(TAG, "OpenXrNativeActivity initializing VideoPlayer for VR mode");
        try {
            videoPlayer = new VideoPlayer(this);
            VideoPlayerHolder.setInstance(videoPlayer);
            videoPlayer.setIVideoParamsChanged(this);
            Log.d(TAG, "OpenXrNativeActivity VideoPlayer initialized successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize VideoPlayer in VR mode", e);
        }
    }

    /**
     * Sets up Mavlink like VideoActivity.setupMavlink()
     */
    private void setupMavlink() {
        Log.d(TAG, "OpenXrNativeActivity setting up Mavlink");
        try {
            handler = new Handler(Looper.getMainLooper());
            Log.d(TAG, "OpenXrNativeActivity Mavlink setup completed");
        } catch (Exception e) {
            Log.e(TAG, "Failed to setup Mavlink", e);
        }
    }

    /**
     * Sets up battery receiver like VideoActivity.setupBatteryReceiver()
     */
    private void setupBatteryReceiver() {
        Log.d(TAG, "OpenXrNativeActivity setting up battery receiver");
        try {
            if (batteryReceiver != null) {
                unregisterReceiver(batteryReceiver);
            }
            IntentFilter batteryFilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            batteryReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent batteryStatus) {
                    handleBatteryUpdate(batteryStatus);
                }
            };
            Intent stickyStatus = registerReceiver(batteryReceiver, batteryFilter);
            if (stickyStatus != null) {
                handleBatteryUpdate(stickyStatus);
            }
            Log.d(TAG, "OpenXrNativeActivity battery receiver setup completed");
        } catch (Exception e) {
            Log.e(TAG, "Failed to setup battery receiver", e);
        }
    }

    // Helper methods copied from VideoActivity
    private void setDefaultGsKey() {
        try {
            SharedPreferences prefs = getSharedPreferences("general", Context.MODE_PRIVATE);
            if (!prefs.contains("gs_key")) {
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString("gs_key", "0123456789ABCDEF0123456789ABCDEF");
                editor.apply();
                Log.d(TAG, "Default GS key set");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to set default GS key", e);
        }
    }

    private void copyGSKey() {
        try {
            SharedPreferences prefs = getSharedPreferences("general", Context.MODE_PRIVATE);
            String key = prefs.getString("gs_key", "0123456789ABCDEF0123456789ABCDEF");
            // Copy key to expected location
            Log.d(TAG, "GS key configured: " + key.substring(0, 8) + "...");
        } catch (Exception e) {
            Log.e(TAG, "Failed to copy GS key", e);
        }
    }

    @Override
    public void onVideoRatioChanged(int videoW, int videoH) {
        Log.d(TAG, "VR Video ratio changed: " + videoW + "x" + videoH);
        lastVideoWidth = videoW;
        lastVideoHeight = videoH;
        updateNativeTexelScale();
        evaluateEnhancementProfile();
        pushVrUiUpdate();
        // In VR mode, we don't need to update UI ratios like in 2D mode
        // The native code handles the video texture directly
    }
    @Override
    public void onDecodingInfoChanged(final DecodingInfo decodingInfo) {
        Log.d(TAG, "VR Decoding info changed - FPS: " + decodingInfo.currentFPS +
                ", Bitrate: " + decodingInfo.currentKiloBitsPerSecond + "kbps");

        lastFpsValue = decodingInfo.currentFPS;
        lastBitrateKbps = decodingInfo.currentKiloBitsPerSecond;
        hasDecodingStats = true;

        evaluateEnhancementProfile();
        pushVrUiUpdate();
    }

    public void applyBackendChannel(final int channel) {
        Handler uiHandler = handler;
        if (uiHandler == null) {
            uiHandler = new Handler(Looper.getMainLooper());
            handler = uiHandler;
        }
        uiHandler.post(() -> {
            try {
                Intent backendIntent = new Intent(VideoActivity.ACTION_BACKEND_CHANNEL_UPDATE);
                backendIntent.putExtra(VideoActivity.EXTRA_BACKEND_CHANNEL, channel);
                sendBroadcast(backendIntent);
                SharedPreferences prefs = getSharedPreferences("general", Context.MODE_PRIVATE);
                prefs.edit().putInt("wifi-channel", channel).apply();
                backendWifiChannelOverride = String.valueOf(channel);
                lastReportedBackendChannel = channel;
                initialChannelReported = true;
                pushVrUiUpdate();
            } catch (Exception e) {
                Log.e(TAG, "Failed to persist backend WiFi channel", e);
            }
        });
    }

    public void updateBackendStatus(final boolean connected, final String deviceId, final String displayMode,
                                    final boolean sessionActive, final String sessionRemaining, final int wifiChannel,
                                    final int batteryLevel, final boolean batteryCharging) {
        Handler uiHandler = handler;
        if (uiHandler == null) {
            uiHandler = new Handler(Looper.getMainLooper());
            handler = uiHandler;
        }
        uiHandler.post(() -> {
            backendConnected = connected;
            backendDeviceId = deviceId != null ? deviceId : "";
            backendDisplayMode = displayMode != null ? displayMode : "";
            backendSessionActive = sessionActive;
            backendSessionRemaining = sessionRemaining != null ? sessionRemaining : "";
            backendSessionSeconds = parseSessionSeconds(sessionRemaining);
            backendBatteryLevel = batteryLevel;
            backendBatteryCharging = batteryCharging;
            if (connected && wifiChannel > 0) {
                backendWifiChannelOverride = String.valueOf(wifiChannel);
                lastReportedBackendChannel = wifiChannel;
                initialChannelReported = true;
            }
            applyDisplayMode(backendDisplayMode);
            if (vrUIManager != null) {
                String startStatus;
        long startArmed;
        long startCountdown;
        int startStepInterval;
        int startLedCount;
        synchronized (startLineLock) {
            startStatus = startLineStatus;
            startArmed = startLineArmedAtMs;
            startCountdown = startLineCountdownAtMs;
            startStepInterval = startLineStepIntervalMs;
            startLedCount = startLineLedCount;
        }

        vrUIManager.updateStartLineState(startStatus, startArmed, startCountdown, startStepInterval, startLedCount);
        vrUIManager.updateStartLineState(startStatus, startArmed, startCountdown, startStepInterval, startLedCount);
        vrUIManager.updateBackendInfo(backendConnected, backendDeviceId, backendDisplayMode, backendSessionActive, backendSessionSeconds, backendBatteryLevel, backendBatteryCharging, buildBackendSessionLabel());
            }
            pushVrUiUpdate();
        });
    }

    private void updateNativeTexelScale() {
        int width = lastVideoWidth > 0 ? lastVideoWidth : 1920;
        int height = lastVideoHeight > 0 ? lastVideoHeight : 1080;
        nativeUpdateTexelScale(1.0f / Math.max(1, width), 1.0f / Math.max(1, height));
    }

    private void evaluateEnhancementProfile() {
        float bitrate = lastBitrateKbps;
        int targetTier;
        int targetMode;
        float targetStrength;

        if (!hasDecodingStats || bitrate <= 0f) {
            targetTier = 0;
            targetMode = 1;
            targetStrength = 0.65f;
        } else if (bitrate < 2800f) {
            targetTier = 0;
            targetMode = 1;
            targetStrength = 0.7f;
        } else if (bitrate < 5200f) {
            targetTier = 1;
            targetMode = 3;
            targetStrength = 0.6f;
        } else {
            targetTier = 2;
            targetMode = 2;
            targetStrength = 0.45f;
        }

        if (targetTier != qualityTier) {
            qualityTier = targetTier;
            nativeSetQualityTier(qualityTier);
        }

        if (targetMode != enhancementMode || Math.abs(targetStrength - enhancementStrength) > 0.02f) {
            enhancementMode = targetMode;
            enhancementStrength = targetStrength;
            nativeSetEnhancementParameters(enhancementMode, enhancementStrength);
        }
    }

    private void applyDisplayMode(String displayMode) {
        String normalized = displayMode == null ? "" : displayMode.trim().toLowerCase(Locale.US);
        int mode = 1; // default curved
        if (normalized.isEmpty() || normalized.equals("single") || normalized.equals("flat")) {
            mode = 0;
        }
        nativeSetDisplaySurfaceMode(mode);
    }

    private int parseSessionSeconds(String value) {
        if (value == null) {
            return 0;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return 0;
        }
        String[] parts = trimmed.split(":");
        if (parts.length != 2) {
            return 0;
        }
        try {
            int minutes = Integer.parseInt(parts[0]);
            int seconds = Integer.parseInt(parts[1]);
            return Math.max(0, minutes * 60 + seconds);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void returnToVideoActivity() {
        Intent intent = new Intent(this, VideoActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finish();
    }

    public void returnToVideoActivityFromNative() {
        runOnUiThread(this::returnToVideoActivity);
    }

    private String buildBackendSessionLabel() {
        int seconds = Math.max(backendSessionSeconds, 0);
        String formatted = String.format(Locale.US, "%02d:%02d", seconds / 60, seconds % 60);
        String state = backendSessionActive ? "Active" : "Idle";
        if (seconds > 0) {
            state += " (" + formatted + ")";
        }
        return state;
    }


    public void updateStartLineStateFromNative(String status, long armedAtMs, long countdownStartedAtMs, int stepIntervalMs, int ledCount) {
        runOnUiThread(() -> updateStartLineStateInternal(status, armedAtMs, countdownStartedAtMs, stepIntervalMs, ledCount));
    }

    private void updateStartLineStateInternal(String status, long armedAtMs, long countdownStartedAtMs, int stepIntervalMs, int ledCount) {
        final String normalized = status != null ? status.toLowerCase(Locale.US) : "idle";
        synchronized (startLineLock) {
            startLineStatus = normalized;
            startLineArmedAtMs = Math.max(0L, armedAtMs);
            startLineCountdownAtMs = Math.max(0L, countdownStartedAtMs);
            startLineStepIntervalMs = stepIntervalMs > 0 ? stepIntervalMs : 1000;
            startLineLedCount = ledCount > 0 ? ledCount : DEFAULT_START_LINE_LED_COUNT;
            if (!"go".equals(startLineStatus) && !"countdown".equals(startLineStatus)) {
                startLineGoSoundPlayed = false;
            }
        }
        checkStartLineSound();
        pushVrUiUpdate();
    }

    private void checkStartLineSound() {
        boolean shouldPlay = false;
        synchronized (startLineLock) {
            final long now = System.currentTimeMillis();
            final long totalDuration = (long) Math.max(1, startLineLedCount) * Math.max(100, startLineStepIntervalMs);
            if ("go".equals(startLineStatus)) {
                if (!startLineGoSoundPlayed) {
                    shouldPlay = true;
                    startLineGoSoundPlayed = true;
                }
            } else if ("countdown".equals(startLineStatus) && startLineCountdownAtMs > 0 && totalDuration > 0) {
                long elapsed = now - startLineCountdownAtMs;
                if (elapsed >= totalDuration && !startLineGoSoundPlayed) {
                    shouldPlay = true;
                    startLineGoSoundPlayed = true;
                }
            } else {
                startLineGoSoundPlayed = false;
            }
        }

        if (shouldPlay) {
            playStartLineSound();
        }
    }

    private void playStartLineSound() {
        if (startLineToneGenerator != null) {
            try {
                startLineToneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP, 200);
            } catch (RuntimeException e) {
                Log.w(TAG, "Failed to play start line sound", e);
            }
        }
    }

    private void pushVrUiUpdate() {
        if (vrUIManager == null) {
            return;
        }

        String wifiChannel = backendWifiChannelOverride;
        if (wifiChannel == null || wifiChannel.isEmpty()) {
            wifiChannel = getCurrentWifiChannel();
        }
        if (wifiChannel == null || wifiChannel.isEmpty()) {
            wifiChannel = "Unknown";
        }

        String fpsLabel = (hasDecodingStats && lastFpsValue > 0f)
                ? String.format(Locale.US, "%.1f", lastFpsValue)
                : "--";

        String resolutionLabel = (lastVideoWidth > 0 && lastVideoHeight > 0)
                ? String.format(Locale.US, "%dx%d", lastVideoWidth, lastVideoHeight)
                : "Unknown";

        String signalLabel;
        if (hasDecodingStats && lastBitrateKbps > 0f) {
            String base = getSignalStrengthFromBitrate((int) lastBitrateKbps);
            signalLabel = String.format(Locale.US, "%s (%.0f kbps)", base, lastBitrateKbps);
        } else if (hasDecodingStats) {
            signalLabel = getSignalStrengthFromBitrate(0);
        } else {
            signalLabel = "Unknown";
        }

        String startStatus;
        long startArmed;
        long startCountdown;
        int startStepInterval;
        int startLedCount;
        synchronized (startLineLock) {
            startStatus = startLineStatus;
            startArmed = startLineArmedAtMs;
            startCountdown = startLineCountdownAtMs;
            startStepInterval = startLineStepIntervalMs;
            startLedCount = startLineLedCount;
        }

        vrUIManager.updateStartLineState(startStatus, startArmed, startCountdown, startStepInterval, startLedCount);
        vrUIManager.updateBackendInfo(backendConnected, backendDeviceId, backendDisplayMode, backendSessionActive, backendSessionSeconds, backendBatteryLevel, backendBatteryCharging, buildBackendSessionLabel());
        vrUIManager.updateStatus(wifiChannel, fpsLabel, resolutionLabel, signalLabel);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BUTTON_B) {
            returnToVideoActivity();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();
        Log.d(TAG, "dispatchKeyEvent: keyCode=" + keyCode + " action=" + action);
        if (keyCode == KeyEvent.KEYCODE_BUTTON_B) {
            if (action == KeyEvent.ACTION_UP) {
                returnToVideoActivity();
            }
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (action == KeyEvent.ACTION_UP) {
                returnToVideoActivity();
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }


    private void handleBatteryUpdate(Intent batteryStatus) {
        if (batteryStatus == null) {
            return;
        }
        int status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        boolean isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL;
        int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level >= 0 && scale > 0) {
            int batteryPct = Math.round((level * 100f) / (float) scale);
            backendBatteryLevel = batteryPct;
            backendBatteryCharging = isCharging;
            pushVrUiUpdate();
            nativeUpdateBackendBattery(batteryPct, isCharging);
        }
    }

    /**
     * Helper method to convert bitrate to signal strength indicator
     */
    private String getSignalStrengthFromBitrate(int bitrateKbps) {
        if (bitrateKbps >= 8000) {
            return "Excellent";
        } else if (bitrateKbps >= 5000) {
            return "Good";
        } else if (bitrateKbps >= 2000) {
            return "Fair";
        } else {
            return "Poor";
        }
    }

    private void captureInitialWifiChannel() {
        if (initialChannelReported) {
            return;
        }
        try {
            int channel = VideoActivity.getChannel(this);
            if (channel > 0) {
                backendWifiChannelOverride = String.valueOf(channel);
                nativeReportWifiChannel(channel);
                lastReportedBackendChannel = channel;
                initialChannelReported = true;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to capture initial WiFi channel", e);
        }
    }

    /**
     * Helper method to get current WiFi channel
     */
    private String getCurrentWifiChannel() {
        try {
            int channel = VideoActivity.getChannel(this);
            if (channel > 0) {
                return String.valueOf(channel);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to read WFB-NG channel from preferences", e);
        }

        return "Unknown";
    }

    /**
     * Called from native code to initialize VRUIManager when OpenGL context is available
     */
    public void initializeVRUIManager() {
        if (vrUIManager != null && !vrUIManager.isInitialized()) {
            try {
                vrUIManager.initialize();
                pushVrUiUpdate();
                Log.d(TAG, "VRUIManager initialized successfully from native code");
            } catch (Exception e) {
                Log.e(TAG, "Failed to initialize VRUIManager from native code", e);
            }
        }
    }

    public void setOverheadPanelVisible(boolean visible) {
        VRUIManager.setOverheadPanelVisible(visible);
    }

    private static native void nativeUpdateBackendBattery(int level, boolean charging);
    private static native void nativeReportWifiChannel(int channel);
    private static native void nativeSetDisplaySurfaceMode(int mode);
    private static native void nativeSetQualityTier(int tier);
    private static native void nativeSetEnhancementParameters(int mode, float strength);
    private static native void nativeUpdateTexelScale(float texelWidth, float texelHeight);

    // JNI methods for VR UI Manager integration
    public static native void nativeUpdateUI(String wifiChannel, String fps, String resolution, String signalStrength);
    public static native void nativeRenderUI(float[] viewMatrix, float[] projectionMatrix);
    public static native void nativeInitializeUI();
    public static native void nativeDisposeUI();
}


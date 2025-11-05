package com.openipc.pixelpilot.vr.ui;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.util.Log;

import java.io.IOException;
import java.util.Locale;

/**
 * VRUIManager - Main UI manager for VR applications
 * Coordinates text rendering and quad panel rendering
 * Based on JavaForQuest architecture for OpenXR integration
 */
public class VRUIManager {
    private static final String TAG = "VRUIManager";

    private static final int DEFAULT_START_LINE_LED_COUNT = 5;
    private static final int MIN_STEP_INTERVAL_MS = 100;
    private static final long OVERHEAD_AUTO_HIDE_DELAY_MS = 10_000L;
    private static final int START_LINE_EXTRA_DELAY_MS = 4000;
    
    private VRTextRenderer textRenderer;
    private VRQuadPanel quadPanel;
    private VRTextRenderer overheadPanelRenderer;
    private VRQuadPanel overheadPanel;
    private SoundPool soundPool;
    private int redLedSoundId = 0;
    private int greenLedSoundId = 0;
    private boolean redLedSoundLoaded = false;
    private boolean greenLedSoundLoaded = false;
    private boolean redLedSoundPending = false;
    private boolean greenLedSoundPending = false;
    private boolean overheadRenderLogged = false;
    private boolean overheadTextureLogged = false;
    
    private Context context;
    private boolean initialized = false;
    private boolean initializationInProgress = false;

    // UI state
    private String wifiChannel = "";
    private String fps = "";
    private String resolution = "";
    private String signalStrength = "";
    private String backendStatus = "";
    private String backendDeviceId = "";
    private String backendDisplayMode = "";
    private String backendSessionInfo = "";
    private boolean backendConnected = false;
    private boolean backendSessionActive = false;
    private int backendSessionSeconds = 0;
    private int backendBatteryLevel = -1;
    private String startLineStatus = "idle";
    private long startLineArmedAtMs = 0L;
    private long startLineCountdownAtMs = 0L;
    private int startLineStepIntervalMs = 1000;
    private int startLineLedCount = DEFAULT_START_LINE_LED_COUNT;
    
    private boolean backendBatteryCharging = false;

    // JNI interface for native code
    private static VRUIManager instance;
    private static volatile boolean overheadPanelVisible = false;
    private long overheadAutoHideDeadlineMs = 0L;
    private boolean overheadAutoHideScheduled = false;
    private boolean overheadArmedSeen = false;
    private int previousOverheadRedLit = 0;
    private boolean previousOverheadGreenOn = false;
    private long startLineGoStartAtMs = 0L;

    public VRUIManager(Context context) {
        this.context = context;
        instance = this;
    }

    public void initialize() {
        if (initialized || initializationInProgress) {
            return;
        }

        initializationInProgress = true;

        try {
            // Initialize text renderer
            textRenderer = new VRTextRenderer();
            textRenderer.initialize(context);

            // Initialize quad panel
            quadPanel = new VRQuadPanel();
            quadPanel.initialize(context);

            // Connect text texture to quad panel
            quadPanel.setTexture(textRenderer.getTextureId());
            quadPanel.setTextureDimensions(textRenderer.getTextureWidth(), textRenderer.getTextureHeight());

            // Position the panel to the right of the video screen
            quadPanel.setPosition(2.0f, 0.9f, -1.0f); // 2m right, 0.9m down, 2m away
            quadPanel.setSize(0.8f, 0.4f); // match 2:1 texture aspect with larger footprint

            // Secondary panel uses its own texture, positioned 2m above the main panel
            overheadPanelRenderer = new VRTextRenderer();
            overheadPanelRenderer.initialize(context);

            overheadPanel = new VRQuadPanel();
            overheadPanel.initialize(context);
            overheadPanel.setTexture(overheadPanelRenderer.getTextureId());
            overheadPanel.setTextureDimensions(overheadPanelRenderer.getTextureWidth(), overheadPanelRenderer.getTextureHeight());
            overheadPanel.setPosition(0.0f, 2.5f, -1.5f); // centered in front of user, 2.5m high
            overheadPanel.setSize(2.4f, 1.2f);

            // Seed textures so both panels show something before the first update cycle runs
            renderStatusTextures(computeStartLineVisualState());
            setOverheadPanelVisible(false);
            initializeSounds();

            initialized = true;
            Log.d(TAG, "VRUIManager initialized successfully");

        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize VRUIManager", e);
            return;
        } finally {
            initializationInProgress = false;
        }
    }

    public void updateStatus(String wifiChannel, String fps, String resolution, String signalStrength) {
        updateStatusInternal(wifiChannel, fps, resolution, signalStrength, true);
    }

    public void updateStartLineState(String status, long armedAtMs, long countdownStartedAtMs, int stepIntervalMs, int ledCount) {
        startLineStatus = status != null ? status.toLowerCase(Locale.US) : "idle";
        startLineArmedAtMs = Math.max(0L, armedAtMs);
        startLineCountdownAtMs = Math.max(0L, countdownStartedAtMs);

        int safeLedCount = ledCount > 0 ? ledCount : DEFAULT_START_LINE_LED_COUNT;
        int baseInterval = stepIntervalMs > 0 ? stepIntervalMs : 1000;
        int extraPerStep = START_LINE_EXTRA_DELAY_MS / Math.max(1, safeLedCount);
        if (START_LINE_EXTRA_DELAY_MS % Math.max(1, safeLedCount) != 0) {
            extraPerStep += 1;
        }

        startLineStepIntervalMs = Math.max(MIN_STEP_INTERVAL_MS, baseInterval + extraPerStep);
        startLineLedCount = safeLedCount;

        if (!"countdown".equals(startLineStatus)) {
            startLineGoStartAtMs = 0L;
        }
    }

    private static class StartLineVisualState {
        final String label;
        final int ledCount;
        final int redLit;
        final boolean greensOn;
        final String status;

        StartLineVisualState(String label, int ledCount, int redLit, boolean greensOn, String status) {
            this.label = label;
            this.ledCount = ledCount;
            this.redLit = redLit;
            this.greensOn = greensOn;
            this.status = status;
        }
    }

    public void updateBackendInfo(boolean connected, String deviceId, String displayMode, boolean sessionActive, int sessionSeconds, int batteryLevel, boolean batteryCharging, String sessionInfo) {
        backendConnected = connected;
        backendStatus = connected ? "Connected" : "Offline";
        backendDeviceId = deviceId != null ? deviceId : "";
        backendDisplayMode = displayMode != null ? displayMode : "";
        backendSessionActive = sessionActive;
        backendSessionSeconds = Math.max(sessionSeconds, 0);
        backendBatteryLevel = batteryLevel;
        backendBatteryCharging = batteryCharging;
        backendSessionInfo = sessionInfo != null ? sessionInfo : "";
    }

private StartLineVisualState computeStartLineVisualState() {
    int configuredLedCount = startLineLedCount > 0 ? startLineLedCount : DEFAULT_START_LINE_LED_COUNT;
    int effectiveLedCount = Math.max(1, configuredLedCount);
    String status = startLineStatus != null ? startLineStatus : "idle";
    String label;
    int redLit = 0;
    boolean greensOn = false;

    if ("armed".equals(status)) {
        label = "";
    } else if ("countdown".equals(status)) {
        long countdownAt = startLineCountdownAtMs;
        int intervalMs = Math.max(MIN_STEP_INTERVAL_MS, startLineStepIntervalMs);
        if (countdownAt > 0L) {
            long now = System.currentTimeMillis();
            long elapsed = now - countdownAt;
            long totalDuration = (long) intervalMs * effectiveLedCount;
            if (elapsed < 0L) {
                redLit = 0;
                long secondsRemaining = (long) Math.ceil(totalDuration / 1000.0);
                label = String.format(Locale.US, "", Math.max(0, secondsRemaining));
                startLineGoStartAtMs = 0L;
            } else {
                redLit = (int) Math.min(effectiveLedCount, (elapsed / intervalMs) + 1);
                long remaining = Math.max(0L, totalDuration - elapsed);
                if (remaining <= 0L) {
                    if (startLineGoStartAtMs == 0L) {
                        startLineGoStartAtMs = countdownAt + totalDuration;
                        if (startLineGoStartAtMs > now) {
                            startLineGoStartAtMs = now;
                        }
                    }
                    long goStart = Math.max(0L, startLineGoStartAtMs);
                    long goElapsed = Math.max(0L, now - goStart);
                    if (goElapsed >= 1000L) {
                        greensOn = true;
                        label = "GO!";
                    } else {
                        long millisRemaining = Math.max(0L, 1000L - goElapsed);
                        long secondsRemaining = (long) Math.ceil(millisRemaining / 1000.0);
                        label = String.format(Locale.US, "", Math.max(0, secondsRemaining));
                    }
                } else {
                    startLineGoStartAtMs = 0L;
                    long secondsRemaining = (long) Math.ceil(remaining / 1000.0);
                    label = String.format(Locale.US, "", Math.max(0, secondsRemaining));
                }
            }
        } else {
            label = "Countdown";
            startLineGoStartAtMs = 0L;
        }
    } else if ("go".equals(status)) {
        label = "GO!";
        greensOn = true;
        redLit = effectiveLedCount;
        startLineGoStartAtMs = 0L;
    } else {
        label = "Idle";
        startLineGoStartAtMs = 0L;
    }

    if (greensOn) {
        redLit = effectiveLedCount;
    }

    redLit = Math.max(0, Math.min(effectiveLedCount, redLit));
    return new StartLineVisualState(label, configuredLedCount, redLit, greensOn, status);
}

    private void updateStatusInternal(String wifiChannel, String fps, String resolution, String signalStrength, boolean pushNative) {
        this.wifiChannel = wifiChannel != null ? wifiChannel : "";
        this.fps = fps != null ? fps : "";
        this.resolution = resolution != null ? resolution : "";
        this.signalStrength = signalStrength != null ? signalStrength : "";

        boolean renderLocally = !pushNative;

        if (pushNative) {
            Log.d(TAG, "Skipping native UI push - using updateStats method instead");
            renderLocally = true;
        }

        if (renderLocally && initialized) {
            renderStatusTextures(computeStartLineVisualState());
        }
    }

    public void render(float[] viewMatrix, float[] projectionMatrix) {
        // No on-screen rendering path used currently
    }

    public void dispose() {
        if (initialized) {
            if (textRenderer != null) {
                textRenderer.dispose();
                textRenderer = null;
            }

            if (overheadPanelRenderer != null) {
                overheadPanelRenderer.dispose();
                overheadPanelRenderer = null;
            }

            if (soundPool != null) {
                soundPool.release();
                soundPool = null;
                redLedSoundId = 0;
                greenLedSoundId = 0;
                redLedSoundLoaded = false;
                greenLedSoundLoaded = false;
                redLedSoundPending = false;
                greenLedSoundPending = false;
            }

            if (quadPanel != null) {
                quadPanel.dispose();
                quadPanel = null;
            }

            if (overheadPanel != null) {
                overheadPanel.dispose();
                overheadPanel = null;
            }
            initialized = false;
            Log.d(TAG, "VRUIManager disposed");
        }
    }

    private void renderStatusTextures(StartLineVisualState visualState) {
        if (!initialized) {
            return;
        }

        updateOverheadVisibility(visualState);

        if (textRenderer != null && textRenderer.isInitialized()) {
            textRenderer.renderPrimaryStatus(
                this.wifiChannel,
                this.fps,
                this.resolution,
                this.signalStrength,
                backendStatus,
                backendDeviceId,
                backendDisplayMode,
                backendSessionInfo,
                backendConnected,
                backendSessionActive,
                backendSessionSeconds,
                backendBatteryLevel,
                backendBatteryCharging
            );
        }

        if (overheadPanelVisible && overheadPanelRenderer != null && overheadPanelRenderer.isInitialized()) {
            boolean redIncreased = visualState.redLit > previousOverheadRedLit;
            boolean greenTurnedOn = !previousOverheadGreenOn && visualState.greensOn;

            boolean shouldPlay = overheadPanelRenderer.renderStartPanel(
                visualState.label,
                visualState.ledCount,
                visualState.redLit,
                visualState.greensOn,
                previousOverheadRedLit,
                previousOverheadGreenOn
            );

            boolean shouldPlayRed = redIncreased && !visualState.greensOn && !greenTurnedOn;

            if (shouldPlay) {
                if (greenTurnedOn) {
                    playSound(greenLedSoundId);
                } else if (shouldPlayRed) {
                    playSound(redLedSoundId);
                }
            }

            previousOverheadRedLit = visualState.redLit;
            previousOverheadGreenOn = visualState.greensOn;

            if (!overheadTextureLogged) {
                Log.d(TAG, "Updated overhead panel texture " + overheadPanelRenderer.getTextureId());
                overheadTextureLogged = true;
            }
        } else {
            previousOverheadRedLit = visualState.redLit;
            previousOverheadGreenOn = visualState.greensOn;
        }
    }

    public boolean isInitialized() {
        return initialized;
    }

    public static void updateStats(String wifiChannel, String fps, String resolution, String signalStrength) {
        if (instance != null) {
            instance.wifiChannel = wifiChannel;
            instance.fps = fps;
            instance.resolution = resolution;
            instance.signalStrength = signalStrength;
            Log.d(TAG, "UI stats updated - WiFi: " + wifiChannel + ", FPS: " + fps + ", Res: " + resolution + ", Sig: " + signalStrength);
        }
    }

    public static native void nativeDisposeUI();
    private static native void nativeSetOverheadPanelVisible(boolean visible);

    public static boolean isOverheadPanelVisible() {
        return overheadPanelVisible;
    }

    public static void setOverheadPanelVisible(boolean visible) {
        overheadPanelVisible = visible;
        nativeSetOverheadPanelVisible(visible);
        if (!visible && instance != null) {
            instance.previousOverheadRedLit = 0;
            instance.previousOverheadGreenOn = false;
        }
    }

    private void playSound(int soundId) {
        if (soundPool == null || soundId == 0) {
            return;
        }
        boolean loaded = (soundId == redLedSoundId && redLedSoundLoaded) ||
                         (soundId == greenLedSoundId && greenLedSoundLoaded);
        if (!loaded) {
            if (soundId == redLedSoundId) {
                redLedSoundPending = true;
            } else if (soundId == greenLedSoundId) {
                greenLedSoundPending = true;
            }
            return;
        }
        soundPool.play(soundId, 1.0f, 1.0f, 1, 0, 1.0f);
    }

    private void initializeSounds() {
        if (soundPool != null) {
            return;
        }

        redLedSoundLoaded = false;
        greenLedSoundLoaded = false;

        try {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

            soundPool = new SoundPool.Builder()
                .setAudioAttributes(attributes)
                .setMaxStreams(2)
                .build();

            soundPool.setOnLoadCompleteListener((pool, sampleId, status) -> {
                if (status != 0) {
                    return;
                }
                if (sampleId == redLedSoundId) {
                    redLedSoundLoaded = true;
                    if (redLedSoundPending) {
                        redLedSoundPending = false;
                        playSound(redLedSoundId);
                    }
                } else if (sampleId == greenLedSoundId) {
                    greenLedSoundLoaded = true;
                    if (greenLedSoundPending) {
                        greenLedSoundPending = false;
                        playSound(greenLedSoundId);
                    }
                }
            });

            AssetFileDescriptor redDescriptor = context.getAssets().openFd("sfx-bip.wav");
            redLedSoundId = soundPool.load(redDescriptor, 1);
            redDescriptor.close();

            AssetFileDescriptor greenDescriptor = context.getAssets().openFd("sfx-horn.wav");
            greenLedSoundId = soundPool.load(greenDescriptor, 1);
            greenDescriptor.close();

        } catch (IOException e) {
            Log.w(TAG, "Failed to load start line sound effects", e);
            if (soundPool != null) {
                soundPool.release();
                soundPool = null;
            }
            redLedSoundId = 0;
            greenLedSoundId = 0;
            redLedSoundLoaded = false;
            greenLedSoundLoaded = false;
            redLedSoundPending = false;
            greenLedSoundPending = false;
        }
    }

    public static void renderToTexture(int textureId, int imageIndex) {
        if (instance != null && instance.initialized) {
            try {
                instance.renderStatusTextures(instance.computeStartLineVisualState());

                // Render the quad panel to the provided texture
                if (instance.quadPanel != null && instance.quadPanel.isInitialized()) {
                    instance.quadPanel.renderToTexture(textureId, imageIndex);
                    Log.d(TAG, "Successfully rendered UI to texture " + textureId + " for image index " + imageIndex);
                } else {
                    Log.w(TAG, "Quad panel not available or not initialized for texture rendering");
                }

            } catch (Exception e) {
                Log.e(TAG, "Failed to render to texture", e);
            }
        } else {
            Log.w(TAG, "VRUIManager instance not available or not initialized");
        }
    }

    public static void renderOverheadToTexture(int textureId, int imageIndex) {
        if (instance != null && instance.initialized && overheadPanelVisible) {
            try {
                instance.renderStatusTextures(instance.computeStartLineVisualState());

                if (instance.overheadPanel != null && instance.overheadPanel.isInitialized()) {
                    instance.overheadPanel.renderToTexture(textureId, imageIndex);
                    Log.d(TAG, "Successfully rendered overhead UI to texture " + textureId + " for image index " + imageIndex);
                } else {
                    Log.w(TAG, "Overhead panel not available or not initialized for texture rendering");
                }

            } catch (Exception e) {
                Log.e(TAG, "Failed to render overhead UI to texture", e);
            }
        } else {
            Log.w(TAG, "VRUIManager overhead panel not available or not visible");
        }
    }

    public static void updateUIFromNative(String wifiChannel, String fps, String resolution, String signalStrength) {
        if (instance != null) {
            instance.updateStatusInternal(wifiChannel, fps, resolution, signalStrength, false);
        }
    }

    public static void renderUIFromNative(float[] viewMatrix, float[] projectionMatrix) {
        if (instance != null) {
            instance.render(viewMatrix, projectionMatrix);
        }
    }

    public static void initializeUIFromNative() {
        if (instance != null && !instance.isInitialized() && !instance.initializationInProgress) {
            Log.d(TAG, "initializeUIFromNative: Initializing VRUIManager from native code");
            instance.initialize();
        }
    }

    public static void disposeUIFromNative() {
        if (instance != null) {
            instance.dispose();
        }
    }

    private void updateOverheadVisibility(StartLineVisualState state) {
        long now = System.currentTimeMillis();
        String status = state.status != null ? state.status : "idle";
        boolean desiredVisible;

        switch (status) {
            case "armed":
            case "countdown":
                overheadArmedSeen = true;
                overheadAutoHideScheduled = false;
                overheadAutoHideDeadlineMs = 0L;
                desiredVisible = true;
                break;
            case "go":
                if (overheadArmedSeen) {
                    if (!overheadAutoHideScheduled) {
                        overheadAutoHideDeadlineMs = now + OVERHEAD_AUTO_HIDE_DELAY_MS;
                        overheadAutoHideScheduled = true;
                    }
                    if (overheadAutoHideScheduled && now >= overheadAutoHideDeadlineMs) {
                        desiredVisible = false;
                        overheadArmedSeen = false;
                    } else {
                        desiredVisible = true;
                    }
                } else {
                    desiredVisible = false;
                    overheadAutoHideScheduled = false;
                    overheadAutoHideDeadlineMs = 0L;
                }
                break;
            default:
                desiredVisible = false;
                overheadAutoHideScheduled = false;
                overheadAutoHideDeadlineMs = 0L;
                overheadArmedSeen = false;
                break;
        }

        if (desiredVisible != overheadPanelVisible) {
            setOverheadPanelVisible(desiredVisible);
            if (!desiredVisible) {
                previousOverheadRedLit = 0;
                previousOverheadGreenOn = false;
            }
        }
    }

    public String getWifiChannel() {
        return wifiChannel;
    }

    public String getFps() {
        return fps;
    }

    public String getResolution() {
        return resolution;
    }

    public String getSignalStrength() {
        return signalStrength;
    }
}

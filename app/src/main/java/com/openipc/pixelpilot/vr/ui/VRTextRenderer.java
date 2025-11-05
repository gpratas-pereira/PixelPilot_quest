package com.openipc.pixelpilot.vr.ui;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PorterDuff;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.opengl.GLES30;
import android.opengl.GLUtils;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * VRTextRenderer - A text rendering component for VR applications
 * Based on JavaForQuest Text class architecture
 * Provides GPU-accelerated text rendering for OpenXR quad layers
 */
public class VRTextRenderer {
    private static final String TAG = "VRTextRenderer";
    
    private int textureId;
    private int textureWidth = 1024;
    private int textureHeight = 512;
    
    private Bitmap bitmap;
    private Canvas canvas;
    private Paint paint;
    
    private Paint ledFillPaint;
    private Paint ledBorderPaint;
    private Paint iconStrokePaint;
    private Paint iconFillPaint;
    private Paint iconBackgroundPaint;
    private Paint rowBackgroundPaint;
    private Paint accentPaint;
    private Paint panelBackgroundPaint;
    private Paint panelBorderPaint;
    private Paint dividerPaint;
    
    private Typeface regularTypeface;
    private Typeface boldTypeface;
    private Typeface monoTypeface;
    private Typeface monoBoldTypeface;

    private final Rect textBounds = new Rect();
    private final RectF scratchRectF = new RectF();
    
    private static final Pattern NUMBER_PATTERN = Pattern.compile("-?\\d+(\\.\\d+)?");
    
    private static final String ICON_LINK = "link";
    private static final String ICON_SESSION = "session";
    private static final String ICON_VIDEO = "video";
    private static final String ICON_WIRELESS = "wireless";
    private static final String ICON_POWER = "power";
    
    private boolean initialized = false;
    
    public VRTextRenderer() {
        // Initialize will be called when context is available
    }
    
    public void initialize(Context context) {
        if (initialized) {
            return;
        }
        
        try {
            // Create OpenGL texture
            int[] textureHandles = new int[1];
            GLES30.glGenTextures(1, textureHandles, 0);
            if (textureHandles[0] == 0) {
                Log.w(TAG, "glGenTextures returned 0; deferring text texture setup until GL context is current");
                GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, 0);
                return;
            }
            textureId = textureHandles[0];
            
            // Create bitmap and canvas for text rendering
            bitmap = Bitmap.createBitmap(textureWidth, textureHeight, Bitmap.Config.ARGB_8888);
            canvas = new Canvas(bitmap);
            
            // Setup paint for text rendering
            paint = new Paint();
            paint.setColor(Color.WHITE);
            paint.setTextSize(18);
            paint.setAntiAlias(true);
            paint.setTextAlign(Paint.Align.LEFT);
            
            regularTypeface = Typeface.create("sans-serif-medium", Typeface.NORMAL);
            boldTypeface = Typeface.create("sans-serif-medium", Typeface.BOLD);
            monoTypeface = Typeface.create("monospace", Typeface.NORMAL);
            monoBoldTypeface = Typeface.create(monoTypeface, Typeface.BOLD);
            paint.setTypeface(regularTypeface);
            
            ledFillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ledFillPaint.setStyle(Paint.Style.FILL);

            ledBorderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ledBorderPaint.setStyle(Paint.Style.STROKE);
            ledBorderPaint.setStrokeWidth(3.0f);

            iconStrokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            iconStrokePaint.setStyle(Paint.Style.STROKE);
            iconStrokePaint.setStrokeWidth(3.0f);
            iconStrokePaint.setStrokeJoin(Paint.Join.ROUND);
            iconStrokePaint.setStrokeCap(Paint.Cap.ROUND);

            iconFillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            iconFillPaint.setStyle(Paint.Style.FILL);

            iconBackgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            iconBackgroundPaint.setStyle(Paint.Style.FILL);

            rowBackgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            rowBackgroundPaint.setStyle(Paint.Style.FILL);

            accentPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            accentPaint.setStyle(Paint.Style.FILL);

            panelBackgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            panelBackgroundPaint.setStyle(Paint.Style.FILL);

            panelBorderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            panelBorderPaint.setStyle(Paint.Style.STROKE);
            panelBorderPaint.setStrokeWidth(2.0f);

            dividerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            dividerPaint.setStyle(Paint.Style.STROKE);
            dividerPaint.setStrokeWidth(1.2f);
            
            // Configure texture parameters
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textureId);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE);
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE);
            
            // Initialize with clear texture
            clearTexture();
            
            initialized = true;
            Log.d(TAG, "VRTextRenderer initialized successfully");
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize VRTextRenderer", e);
            throw e;
        }
    }
    
    public void clearTexture() {
        if (!initialized || canvas == null) return;
        
        // Clear canvas with transparent background
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
        
        // Upload to GPU
        uploadTexture();
    }
    
    public void renderText(String text, float x, float y) {
        renderText(text, x, y, Color.WHITE, 24);
    }
    
    public void renderText(String text, float x, float y, int color, float textSize) {
        if (!initialized || canvas == null) {
            Log.w(TAG, "TextRenderer not initialized");
            return;
        }
        
        try {
            // Configure paint
            paint.setColor(color);
            paint.setTextSize(textSize);
            paint.setTypeface(regularTypeface != null ? regularTypeface : Typeface.DEFAULT);
            paint.setFakeBoldText(false);
            paint.setStyle(Paint.Style.FILL);
            
            // Clear and draw text
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
            canvas.drawText(text, x, y, paint);
            
            // Upload to GPU
            uploadTexture();
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to render text: " + text, e);
        }
    }
    
    public void renderPrimaryStatus(String wifiChannel, String fps, String resolution, String signalStrength,
                                    String backendStatus, String backendDeviceId, String backendDisplayMode, String sessionInfo,
                                    boolean backendConnected, boolean sessionActive, int sessionSeconds, int batteryLevel, boolean batteryCharging) {
        if (!initialized || canvas == null) {
            return;
        }

        try {
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);

            final float outerMargin = 10f;
            scratchRectF.set(outerMargin, outerMargin, textureWidth - outerMargin, textureHeight - outerMargin);
            panelBackgroundPaint.setColor(Color.argb(215, 14, 22, 32));
            canvas.drawRoundRect(scratchRectF, 42f, 42f, panelBackgroundPaint);

            panelBorderPaint.setColor(Color.argb(120, 120, 180, 220));
            canvas.drawRoundRect(scratchRectF, 42f, 42f, panelBorderPaint);

            final float contentLeft = outerMargin + 16f;
            final float contentRight = textureWidth - outerMargin - 16f;
            float cursorY = outerMargin + 34f;

            final int labelColor = Color.argb(220, 190, 200, 210);
            final int tertiaryColor = Color.argb(170, 145, 155, 170);

            List<StyledSegment> headerSegments = segments(
                    seg("Pilot ", Color.argb(220, 198, 210, 224), 30f, false, false),
                    seg("HUD", Color.argb(255, 96, 195, 255), 30f, true, false)
            );
            drawStyledSegments(contentLeft, cursorY, headerSegments, contentRight - contentLeft);

            cursorY += 10f;
            dividerPaint.setColor(Color.argb(80, 170, 190, 210));
            canvas.drawLine(contentLeft, cursorY, contentRight, cursorY, dividerPaint);
            cursorY += 20f;

            String backendLabel = !isNullOrEmpty(backendStatus) ? backendStatus : "Offline";
            int linkAccent = backendConnected ? Color.rgb(82, 220, 168) : Color.rgb(255, 96, 96);

            List<StyledSegment> linkPrimary = segments(
                    seg(backendLabel, linkAccent, 26f, true, false)
            );

            List<StyledSegment> linkSecondary = new ArrayList<>();
            if (!isNullOrEmpty(backendDeviceId)) {
                linkSecondary.add(seg("Device ", labelColor, 20f, false, false));
                linkSecondary.add(seg(backendDeviceId, Color.WHITE, 20f, false, true));
            }
            if (!isNullOrEmpty(backendDisplayMode)) {
                if (!linkSecondary.isEmpty()) {
                    linkSecondary.add(seg(" | ", tertiaryColor, 18f, false, false));
                }
                linkSecondary.add(seg("Mode ", labelColor, 20f, false, false));
                linkSecondary.add(seg(backendDisplayMode, Color.WHITE, 20f, false, false));
            }

            cursorY = drawTelemetryRow(
                    ICON_LINK,
                    linkAccent,
                    cursorY,
                    linkPrimary,
                    linkSecondary,
                    contentLeft,
                    contentRight
            );

            String sessionLabel = !isNullOrEmpty(sessionInfo)
                    ? sessionInfo
                    : (sessionActive ? "Session Active" : "Session Standby");
            int sessionAccent = resolveSessionColor(sessionActive, sessionSeconds);

            List<StyledSegment> sessionPrimary = segments(
                    seg(sessionLabel, sessionAccent, 24f, true, false)
            );

            List<StyledSegment> sessionSecondary = new ArrayList<>();
            sessionSecondary.add(seg(sessionActive ? "Elapsed " : "Duration ", labelColor, 20f, false, false));
            sessionSecondary.add(seg(formatDuration(sessionSeconds), Color.WHITE, 20f, false, true));
            if (sessionActive) {
                sessionSecondary.add(seg(" | LIVE", sessionAccent, 20f, true, false));
            } else if (backendConnected) {
                sessionSecondary.add(seg(" | Ready", tertiaryColor, 20f, false, false));
            }

            cursorY = drawTelemetryRow(
                    ICON_SESSION,
                    sessionAccent,
                    cursorY,
                    sessionPrimary,
                    sessionSecondary,
                    contentLeft,
                    contentRight
            );

            Float fpsValue = parseMetricValue(fps);
            int videoAccent = Color.rgb(110, 190, 255);
            int fpsColor = resolveFpsColor(fpsValue);

            List<StyledSegment> videoPrimary = segments(
                    seg("FPS ", labelColor, 20f, false, false),
                    seg(!isNullOrEmpty(fps) ? fps : formatValue(fpsValue), fpsColor, 28f, true, true)
            );

            List<StyledSegment> videoSecondary = new ArrayList<>();
            videoSecondary.add(seg("Resolution ", labelColor, 18f, false, false));
            videoSecondary.add(seg(!isNullOrEmpty(resolution) ? resolution : "--", Color.WHITE, 18f, false, true));

            cursorY = drawTelemetryRow(
                    ICON_VIDEO,
                    videoAccent,
                    cursorY,
                    videoPrimary,
                    videoSecondary,
                    contentLeft,
                    contentRight
            );

            Float signalValue = parseMetricValue(signalStrength);
            int wirelessAccent = Color.rgb(140, 180, 255);
            int signalColor = resolveSignalColor(signalValue);

            List<StyledSegment> wirelessPrimary = segments(
                    seg("Channel ", labelColor, 20f, false, false),
                    seg(!isNullOrEmpty(wifiChannel) ? wifiChannel : "--", Color.WHITE, 26f, true, true)
            );

            List<StyledSegment> wirelessSecondary = new ArrayList<>();
            wirelessSecondary.add(seg("Signal ", labelColor, 18f, false, false));
            wirelessSecondary.add(seg(!isNullOrEmpty(signalStrength) ? signalStrength : "--", signalColor, 18f, false, true));

            cursorY = drawTelemetryRow(
                    ICON_WIRELESS,
                    wirelessAccent,
                    cursorY,
                    wirelessPrimary,
                    wirelessSecondary,
                    contentLeft,
                    contentRight
            );

            Float batterySample = batteryLevel >= 0 ? (float) batteryLevel : null;
            int batteryAccent = resolveBatteryColor(batteryLevel, batteryCharging);

            List<StyledSegment> powerPrimary = segments(
                    seg("Headset Battery ", labelColor, 20f, false, false),
                    seg(batterySample != null ? String.format(Locale.US, "%d%%", Math.round(batterySample)) : "--", batteryAccent, 28f, true, true),
                    batteryCharging && batterySample != null ? seg("  Charging", Color.CYAN, 20f, true, false) : null
            );

            List<StyledSegment> powerSecondary = new ArrayList<>();
            powerSecondary.add(seg("Power state ", labelColor, 18f, false, false));
            if (batterySample != null) {
                powerSecondary.add(seg(batteryCharging ? "Charging" : "Discharging", batteryCharging ? Color.CYAN : tertiaryColor, 18f, true, true));
            } else {
                powerSecondary.add(seg("Unknown", tertiaryColor, 18f, true, true));
            }

            drawTelemetryRow(
                    ICON_POWER,
                    batteryAccent,
                    cursorY,
                    powerPrimary,
                    powerSecondary,
                    contentLeft,
                    contentRight
            );

            uploadTexture();

        } catch (Exception e) {
            Log.e(TAG, "Failed to render status info", e);
        }
    }

    public boolean renderStartPanel(String startLineLabel, int startLineLedCount, int startLineRedLit, boolean startLineGreenOn,
                                    int previousRedLit, boolean previousGreenOn) {
        if (!initialized || canvas == null) {
            return false;
        }

        try {
            canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(0, 0, 0, 0));
            canvas.drawRoundRect(new RectF(24f, 24f, textureWidth - 24f, textureHeight - 34f), 30f, 30f, paint);

            drawStartLineDisplay(startLineLabel, startLineLedCount, startLineRedLit, startLineGreenOn);

            uploadTexture();

        } catch (Exception e) {
            Log.e(TAG, "Failed to render start panel", e);
            return false;
        }

        boolean redLedIncreased = startLineRedLit > previousRedLit;
        boolean greenStateChanged = startLineGreenOn != previousGreenOn;
        return redLedIncreased || greenStateChanged;
    }
    
    private void drawStartLineDisplay(String label, int ledCount, int redLitCount, boolean greensOn) {
        if (canvas == null || ledCount <= 0) {
            return;
        }

        int effectiveLedCount = Math.max(1, ledCount);
        int visibleLedCount = Math.min(effectiveLedCount, 8);
        int clampedRed = Math.max(0, Math.min(visibleLedCount, redLitCount));
        float startX = 380f;
        float topY = 80f;
        float bottomY = topY + 88f;
        float radius = 18f;
        float spacing = visibleLedCount > 1 ? Math.min(70f, 320f / (visibleLedCount - 1)) : 0f;

        for (int i = 0; i < visibleLedCount; i++) {
            float cx = startX + i * spacing;

            // Top row (green LEDs)
            int greenColor = greensOn ? Color.rgb(0, 255, 85) : Color.argb(80, 30, 70, 40);
            ledFillPaint.setColor(greenColor);
            canvas.drawCircle(cx, topY, radius, ledFillPaint);
            ledBorderPaint.setColor(Color.argb(180, 255, 255, 255));
            canvas.drawCircle(cx, topY, radius, ledBorderPaint);

            // Bottom row (red LEDs)
            int redColor = i < clampedRed ? Color.rgb(255, 0, 0) : Color.argb(90, 100, 30, 30);
            ledFillPaint.setColor(redColor);
            canvas.drawCircle(cx, bottomY, radius, ledFillPaint);
            ledBorderPaint.setColor(Color.argb(200, 255, 200, 200));
            canvas.drawCircle(cx, bottomY, radius, ledBorderPaint);
        }

        if (label != null && !label.isEmpty()) {
            paint.setColor(Color.WHITE);
            paint.setTextSize(18f);
            paint.setTextAlign(Paint.Align.LEFT);
            canvas.drawText(label, 260f, 260f, paint);
        }
    }

    private static boolean isNullOrEmpty(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static class StyledSegment {
        final String text;
        final int color;
        final float textSize;
        final boolean bold;
        final boolean mono;

        StyledSegment(String text, int color, float textSize, boolean bold, boolean mono) {
            this.text = text != null ? text : "";
            this.color = color;
            this.textSize = textSize;
            this.bold = bold;
            this.mono = mono;
        }
    }

    private StyledSegment seg(String text, int color, float textSize, boolean bold, boolean mono) {
        return new StyledSegment(text, color, textSize, bold, mono);
    }

    private List<StyledSegment> segments(StyledSegment... candidates) {
        List<StyledSegment> result = new ArrayList<>();
        if (candidates == null) {
            return result;
        }
        for (StyledSegment candidate : candidates) {
            if (candidate != null && (!isNullOrEmpty(candidate.text) || candidate.textSize > 0f)) {
                result.add(candidate);
            }
        }
        return result;
    }

    private float drawStyledSegments(float originX, float baselineY, List<StyledSegment> segments, float maxWidth) {
        if (segments == null || segments.isEmpty()) {
            return originX;
        }

        float cursorX = originX;
        final float limitX = originX + Math.max(0f, maxWidth);

        for (StyledSegment segment : segments) {
            if (segment == null || isNullOrEmpty(segment.text)) {
                continue;
            }

            Typeface targetTypeface;
            if (segment.mono) {
                targetTypeface = segment.bold ? monoBoldTypeface : monoTypeface;
            } else {
                targetTypeface = segment.bold ? boldTypeface : regularTypeface;
            }
            if (targetTypeface == null) {
                targetTypeface = Typeface.DEFAULT;
            }

            paint.setTypeface(targetTypeface);
            paint.setFakeBoldText(false);
            paint.setColor(segment.color);
            paint.setTextSize(segment.textSize);

            String displayText = segment.text;
            float availableWidth = limitX - cursorX;
            if (availableWidth <= 0f) {
                break;
            }

            float textWidth = paint.measureText(displayText);
            if (textWidth > availableWidth) {
                displayText = ellipsizeText(displayText, paint, availableWidth);
                textWidth = paint.measureText(displayText);
            }

            if (!displayText.isEmpty()) {
                canvas.drawText(displayText, cursorX, baselineY, paint);
                cursorX += textWidth;
            }
        }

        paint.setTypeface(regularTypeface != null ? regularTypeface : Typeface.DEFAULT);
        paint.setTextSize(18f);
        paint.setColor(Color.WHITE);

        return cursorX;
    }

    private String ellipsizeText(String value, Paint workingPaint, float maxWidth) {
        if (isNullOrEmpty(value)) {
            return "";
        }
        if (workingPaint.measureText(value) <= maxWidth) {
            return value;
        }
        final String ellipsis = "...";
        float ellipsisWidth = workingPaint.measureText(ellipsis);
        if (ellipsisWidth >= maxWidth) {
            return "";
        }
        int endIndex = value.length();
        while (endIndex > 0 && workingPaint.measureText(value, 0, endIndex) + ellipsisWidth > maxWidth) {
            endIndex--;
        }
        if (endIndex <= 0) {
            return "";
        }
        return value.substring(0, endIndex) + ellipsis;
    }

    private float drawTelemetryRow(String iconKey,
                                   int accentColor,
                                   float rowTop,
                                   List<StyledSegment> primarySegments,
                                   List<StyledSegment> secondarySegments,
                                   float contentLeft,
                                   float contentRight) {
        final float rowHeight = 64f;
        final float rowBottom = rowTop + rowHeight;

        // Background panel with subtle accent
        scratchRectF.set(contentLeft, rowTop, contentRight, rowBottom);
        rowBackgroundPaint.setColor(Color.argb(70, 18, 28, 38));
        canvas.drawRoundRect(scratchRectF, 24f, 24f, rowBackgroundPaint);

        // Accent bar
        accentPaint.setColor(accentColor);
        canvas.drawRoundRect(new RectF(contentLeft + 2f, rowTop + 10f, contentLeft + 6f, rowBottom - 10f),
                3f, 3f, accentPaint);

        // Icon background
        float iconBoxSize = 42f;
        float iconBoxLeft = contentLeft + 14f;
        float iconBoxTop = rowTop + (rowHeight - iconBoxSize) / 2f;
        scratchRectF.set(iconBoxLeft, iconBoxTop, iconBoxLeft + iconBoxSize, iconBoxTop + iconBoxSize);
        iconBackgroundPaint.setColor(Color.argb(50, Color.red(accentColor), Color.green(accentColor), Color.blue(accentColor)));
        canvas.drawRoundRect(scratchRectF, 16f, 16f, iconBackgroundPaint);

        drawIcon(iconKey, accentColor, scratchRectF);

        float textLeft = iconBoxLeft + iconBoxSize + 16f;
        float textWidthLimit = Math.max(0f, contentRight - textLeft - 16f);

        float primaryBaseline = rowTop + 26f;
        float secondaryBaseline = rowBottom - 16f;

        drawStyledSegments(textLeft, primaryBaseline, primarySegments, textWidthLimit);
        drawStyledSegments(textLeft, secondaryBaseline, secondarySegments, textWidthLimit);

        return rowBottom + 8f;
    }

    private void drawIcon(String iconKey, int accentColor, RectF bounds) {
        iconStrokePaint.setColor(accentColor);
        iconFillPaint.setColor(accentColor);

        float cx = bounds.centerX();
        float cy = bounds.centerY();
        float radius = Math.min(bounds.width(), bounds.height()) / 2f - 6f;

        switch (iconKey) {
            case ICON_LINK:
                drawLinkIcon(cx, cy, radius);
                break;
            case ICON_SESSION:
                drawSessionIcon(cx, cy, radius);
                break;
            case ICON_VIDEO:
                drawVideoIcon(cx, cy, radius);
                break;
            case ICON_WIRELESS:
                drawWirelessIcon(cx, cy, radius);
                break;
            case ICON_POWER:
                drawPowerIcon(cx, cy, radius);
                break;
            default:
                iconStrokePaint.setStyle(Paint.Style.STROKE);
                canvas.drawCircle(cx, cy, radius, iconStrokePaint);
                break;
        }

        iconStrokePaint.setStrokeWidth(3.0f);
        iconStrokePaint.setStyle(Paint.Style.STROKE);
        iconFillPaint.setStyle(Paint.Style.FILL);
    }

    private void drawLinkIcon(float cx, float cy, float radius) {
        float segment = radius * 0.85f;
        iconStrokePaint.setStyle(Paint.Style.STROKE);
        canvas.drawArc(cx - segment, cy - radius * 0.8f, cx + segment, cy + radius * 0.2f,
                200f, 140f, false, iconStrokePaint);
        canvas.drawArc(cx - segment, cy - radius * 0.2f, cx + segment, cy + radius * 0.8f,
                20f, 140f, false, iconStrokePaint);
    }

    private void drawSessionIcon(float cx, float cy, float radius) {
        iconStrokePaint.setStyle(Paint.Style.STROKE);
        canvas.drawCircle(cx, cy, radius, iconStrokePaint);
        iconStrokePaint.setStrokeWidth(3.5f);
        canvas.drawLine(cx, cy, cx, cy - radius * 0.65f, iconStrokePaint);
        canvas.drawLine(cx, cy, cx + radius * 0.55f, cy, iconStrokePaint);
        iconStrokePaint.setStrokeWidth(3.0f);
    }

    private void drawVideoIcon(float cx, float cy, float radius) {
        iconStrokePaint.setStyle(Paint.Style.STROKE);
        float left = cx - radius * 0.8f;
        float top = cy - radius * 0.6f;
        float right = cx + radius * 0.3f;
        float bottom = cy + radius * 0.6f;
        canvas.drawRoundRect(new RectF(left, top, right, bottom), 6f, 6f, iconStrokePaint);
        Path playPath = new Path();
        playPath.moveTo(cx - radius * 0.35f, cy - radius * 0.35f);
        playPath.lineTo(cx - radius * 0.35f, cy + radius * 0.35f);
        playPath.lineTo(cx + radius * 0.25f, cy);
        playPath.close();
        iconFillPaint.setStyle(Paint.Style.FILL);
        canvas.drawPath(playPath, iconFillPaint);
    }

    private void drawWirelessIcon(float cx, float cy, float radius) {
        iconStrokePaint.setStyle(Paint.Style.STROKE);
        float base = radius * 0.9f;
        canvas.drawArc(cx - base, cy - base, cx + base, cy + base, 200f, 140f, false, iconStrokePaint);
        float mid = radius * 0.6f;
        canvas.drawArc(cx - mid, cy - mid, cx + mid, cy + mid, 200f, 140f, false, iconStrokePaint);
        float inner = radius * 0.3f;
        canvas.drawArc(cx - inner, cy - inner, cx + inner, cy + inner, 200f, 140f, false, iconStrokePaint);
        canvas.drawCircle(cx, cy + radius * 0.55f, radius * 0.12f, iconFillPaint);
    }

    private void drawPowerIcon(float cx, float cy, float radius) {
        iconStrokePaint.setStyle(Paint.Style.STROKE);
        canvas.drawArc(cx - radius, cy - radius, cx + radius, cy + radius, 200f, 320f, false, iconStrokePaint);
        canvas.drawLine(cx, cy - radius * 1.05f, cx, cy - radius * 0.35f, iconStrokePaint);
        iconFillPaint.setStyle(Paint.Style.FILL);
        iconFillPaint.setColor(iconStrokePaint.getColor());
        canvas.drawCircle(cx, cy + radius * 0.6f, radius * 0.18f, iconFillPaint);
    }

    private Float parseMetricValue(String raw) {
        if (isNullOrEmpty(raw)) {
            return null;
        }
        Matcher matcher = NUMBER_PATTERN.matcher(raw);
        if (matcher.find()) {
            try {
                return Float.parseFloat(matcher.group());
            } catch (NumberFormatException ignore) {
                return null;
            }
        }
        return null;
    }

    private String formatValue(Float value) {
        if (value == null) {
            return "--";
        }
        if (Math.abs(value) >= 100f) {
            return String.format(Locale.US, "%.0f", value);
        }
        if (Math.abs(value) >= 10f) {
            return String.format(Locale.US, "%.1f", value);
        }
        return String.format(Locale.US, "%.2f", value);
    }

    private String formatDuration(int seconds) {
        int safeSeconds = Math.max(0, seconds);
        int hours = safeSeconds / 3600;
        int minutes = (safeSeconds % 3600) / 60;
        int secs = safeSeconds % 60;
        if (hours > 0) {
            return String.format(Locale.US, "%dh %02dm", hours, minutes);
        }
        if (minutes > 0) {
            return String.format(Locale.US, "%dm %02ds", minutes, secs);
        }
        return String.format(Locale.US, "%ds", secs);
    }

    private int resolveSessionColor(boolean sessionActive, int sessionSeconds) {
        if (!sessionActive) {
            return Color.rgb(252, 196, 114);
        }
        if (sessionSeconds >= 60) {
            return Color.rgb(96, 220, 160);
        }
        if (sessionSeconds >= 30) {
            return Color.rgb(255, 210, 120);
        }
        return Color.rgb(255, 120, 120);
    }

    private int resolveFpsColor(Float value) {
        if (value == null) {
            return Color.WHITE;
        }
        if (value >= 90f) {
            return Color.rgb(96, 220, 160);
        }
        if (value >= 60f) {
            return Color.rgb(236, 200, 120);
        }
        return Color.rgb(252, 136, 136);
    }

    private int resolveSignalColor(Float value) {
        if (value == null) {
            return Color.WHITE;
        }
        if (value >= 80f) {
            return Color.rgb(96, 220, 160);
        }
        if (value >= 50f) {
            return Color.rgb(236, 200, 120);
        }
        return Color.rgb(252, 136, 136);
    }

    private int resolveBatteryColor(int level, boolean charging) {
        if (level < 0) {
            return Color.argb(220, 200, 210, 220);
        }
        if (charging) {
            return Color.rgb(120, 220, 255);
        }
        if (level >= 60) {
            return Color.rgb(96, 220, 160);
        }
        if (level >= 30) {
            return Color.rgb(236, 200, 120);
        }
        return Color.rgb(252, 136, 136);
    }

    private void uploadTexture() {
        if (!initialized) return;
        
        try {
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textureId);
            GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA, bitmap, 0);
            GLES30.glGenerateMipmap(GLES30.GL_TEXTURE_2D);
        } catch (Exception e) {
            Log.e(TAG, "Failed to upload texture to GPU", e);
        }
    }
    
    public int getTextureId() {
        return textureId;
    }
    
    public int getTextureWidth() {
        return textureWidth;
    }
    
    public int getTextureHeight() {
        return textureHeight;
    }
    
    public boolean isInitialized() {
        return initialized;
    }
    
    public void dispose() {
        if (initialized) {
            if (textureId != 0) {
                int[] textures = {textureId};
                GLES30.glDeleteTextures(1, textures, 0);
                textureId = 0;
            }
            
            if (bitmap != null) {
                bitmap.recycle();
                bitmap = null;
            }
            
            canvas = null;
            paint = null;
            
            initialized = false;
            Log.d(TAG, "VRTextRenderer disposed");
        }
    }
}

package com.openipc.pixelpilot;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import java.util.HashMap;
import android.net.VpnService;
import android.os.Bundle;
import android.util.Log;
import android.os.Build;
import android.view.View;
import android.view.WindowManager;

import androidx.appcompat.app.AppCompatActivity;
import android.annotation.SuppressLint;

import com.openipc.mavlink.MavlinkData;
import com.openipc.mavlink.MavlinkNative;
import com.openipc.mavlink.MavlinkUpdate;
import com.openipc.pixelpilot.databinding.ActivityVideoBinding;
import com.openipc.pixelpilot.vr.CurvedScreenGLView;
import com.openipc.pixelpilot.osd.OSDManager;
import com.openipc.videonative.DecodingInfo;
import com.openipc.videonative.IVideoParamsChanged;
import com.openipc.videonative.VideoPlayer;
import com.openipc.wfbngrtl8812.WfbNGStats;
import com.openipc.wfbngrtl8812.WfbNGStatsChanged;
import com.openipc.wfbngrtl8812.WfbNgLink;

/**
 * Lightweight VR Activity without Meta Spatial SDK.
 * Uses dual SurfaceViews for stereoscopic rendering.
 */
public class VRSpatialActivity extends AppCompatActivity implements
        IVideoParamsChanged, WfbNGStatsChanged, MavlinkUpdate, SettingsChanged {

    private static final String TAG = "PixelPilot_VR";

    private ActivityVideoBinding binding;
    private VideoPlayer videoPlayer;
    private CurvedScreenGLView curvedView;
    private WfbNgLink wfbLink;
    private WfbLinkManager wfbLinkManager;
    private OSDManager osdManager;
    private boolean receiverRegistered = false;
    // DVR/VPN helpers
    private static final int VPN_REQUEST_CODE = 100;
    private void toast(String msg) {
        Log.d(TAG, "STATUS: " + msg);
        try { android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).show(); } catch (Throwable ignored) {}
        
        // Run on UI thread to ensure proper updates
        runOnUiThread(() -> {
            try { 
                binding.tvMessage.setText(msg); 
                binding.tvMessage.setVisibility(View.VISIBLE);
                
                // Apply VR-optimized styling every time
                binding.tvMessage.setTextSize(36); // Extra large text
                binding.tvMessage.setTextColor(0xFFFFFF00); // Bright yellow
                binding.tvMessage.setBackgroundColor(0xEE000000); // Very dark background
                binding.tvMessage.setPadding(50, 50, 50, 50);
                binding.tvMessage.setElevation(30f);
                
                binding.tvMessage.bringToFront();
                binding.tvMessage.invalidate();
                binding.tvMessage.requestLayout();
                
                Log.d(TAG, "VR UI: Message updated to: " + msg);
            } catch (Throwable e) {
                Log.w(TAG, "VR UI: Error updating message", e);
            }
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.d(TAG, "VR Activity onCreate - SIMPLE TEST VERSION");

        // VR-specific window setup
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        
        Log.d(TAG, "VR Mode: Creating simple test view");
        
        // Create a super simple colored view to test VR readiness
        android.widget.TextView testView = new android.widget.TextView(this);
        testView.setText("VR TEST - SHOULD EXIT 3-DOT SCREEN");
        testView.setTextSize(24);
        testView.setTextColor(0xFFFFFFFF); // White text
        testView.setBackgroundColor(0xFF0000FF); // Blue background
        testView.setGravity(android.view.Gravity.CENTER);
        
        // Set simple view as content
        setContentView(testView);
        
        Log.d(TAG, "VR Mode: Simple test view set - should signal VR readiness");
        
        // Force immediate rendering
        testView.post(() -> {
            testView.requestLayout();
            testView.invalidate();
            Log.d(TAG, "VR Mode: Simple view rendered - Meta Quest should exit loading screen");
        });

        Log.d(TAG, "VR Mode: SIMPLE TEST - skipping complex initialization");
        Log.d(TAG, "VR Mode: If this works, we'll know the issue is in the complex components");
    }
    
    private void startAdapterStatusMonitoring() {
        android.os.Handler handler = new android.os.Handler();
        Runnable statusChecker = new Runnable() {
            @Override
            public void run() {
                try {
                    java.util.Map<String, android.hardware.usb.UsbDevice> activeAdapters = WfbLinkManager.activeWifiAdapters;
                    Log.d(TAG, "VR Mode: Active adapters count: " + activeAdapters.size());
                    if (activeAdapters.isEmpty()) {
                        toast("VR Mode: No active adapters - check USB connection and permissions");
                    } else {
                        toast("VR Mode: " + activeAdapters.size() + " adapter(s) active");
                    }
                } catch (Exception e) {
                    Log.e(TAG, "VR Mode: Error checking adapter status", e);
                }
                handler.postDelayed(this, 10000); // Check every 10 seconds
            }
        };
        handler.postDelayed(statusChecker, 5000); // Start after 5 seconds
    }

    public static int getChannel(Context context) {
        return context.getSharedPreferences("general", Context.MODE_PRIVATE)
                .getInt("wifi-channel", 161);
    }

    public static int getBandwidth(Context context) {
        return context.getSharedPreferences("general", Context.MODE_PRIVATE)
                .getInt("bandwidth", 20);
    }

    private void checkInitialAdapters() {
        try {
            UsbManager usbManager = (UsbManager) getSystemService(Context.USB_SERVICE);
            if (usbManager != null) {
                HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
                Log.d(TAG, "VR Mode: Found " + deviceList.size() + " USB devices");
                
                if (deviceList.isEmpty()) {
                    toast("VR Mode: No USB devices detected - connect RTL8812AU adapter");
                } else {
                    StringBuilder deviceInfo = new StringBuilder();
                    deviceInfo.append("VR Mode: Found ").append(deviceList.size()).append(" USB device(s): ");
                    
                    for (UsbDevice device : deviceList.values()) {
                        deviceInfo.append(String.format("[%04X:%04X] ", 
                            device.getVendorId(), device.getProductId()));
                        Log.d(TAG, String.format("VR Mode: USB device %04X:%04X name=%s", 
                            device.getVendorId(), device.getProductId(), device.getDeviceName()));
                    }
                    toast(deviceInfo.toString());
                }
            } else {
                toast("VR Mode: USB Manager not available");
            }
        } catch (Exception e) {
            Log.e(TAG, "VR Mode: Error checking initial adapters", e);
            toast("VR Mode: Error checking USB devices: " + e.getMessage());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "VR Activity onResume - signaling VR runtime readiness");
        
        // Force VR mode to start properly
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
        
        // Resume GL rendering immediately
        if (curvedView != null) {
            curvedView.onResume();
            curvedView.requestRender();
            Log.d(TAG, "VR Mode: GL rendering resumed");
        }

        if (videoPlayer != null) {
            try {
                if (!videoPlayer.isRunning()) {
                    videoPlayer.start();
                    videoPlayer.startAudio();
                }
            } catch (Throwable t) {
                Log.w(TAG, "VR Mode: videoPlayer start ignored", t);
            }
        }

        // Skip adapter work if manager not initialized (simple VR test path)
        if (wfbLinkManager != null) {
            try {
                wfbLinkManager.refreshAdapters();
                wfbLinkManager.startAdapters();
            } catch (Throwable t) {
                Log.w(TAG, "VR Mode: wfbLinkManager refresh/start ignored", t);
            }

            // Register USB receiver for adapter permission/attach/detach
            if (!receiverRegistered) {
                try {
                    IntentFilter usbFilter = new IntentFilter();
                    usbFilter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
                    usbFilter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
                    usbFilter.addAction(WfbLinkManager.ACTION_USB_PERMISSION);
                    if (Build.VERSION.SDK_INT >= 33) {
                        try { registerReceiver(wfbLinkManager, usbFilter, Context.RECEIVER_NOT_EXPORTED); }
                        catch (Throwable t) { registerReceiver(wfbLinkManager, usbFilter); }
                    } else {
                        // Older API compatibility
                        registerReceiver(wfbLinkManager, usbFilter);
                    }
                    receiverRegistered = true;
                } catch (Throwable t) {
                    Log.w(TAG, "VR Mode: USB receiver registration skipped", t);
                }
            }
        } else {
            Log.d(TAG, "VR Mode: wfbLinkManager is null; skipping adapter setup (test mode)");
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (videoPlayer != null) {
            try { videoPlayer.stop(); videoPlayer.stopAudio(); } catch (Throwable ignored) {}
        }
        if (wfbLinkManager != null) {
            try { wfbLinkManager.stopAdapters(); } catch (Throwable ignored) {}
        }

        if (receiverRegistered && wfbLinkManager != null) {
            try { unregisterReceiver(wfbLinkManager); } catch (Throwable ignored) {}
            receiverRegistered = false;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            Log.d(TAG, "VR Mode: Window focus gained - VR should be ready now");
            // This is often the signal Meta Quest needs to exit loading screen
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        MavlinkNative.nativeStop(this);
    }

    @Override
    public void onVideoRatioChanged(int videoW, int videoH) {
        if (curvedView != null) {
            runOnUiThread(() -> curvedView.setVideoAspect(videoW, videoH));
        }
    }

    @Override
    public void onDecodingInfoChanged(DecodingInfo decodingInfo) {
        // Optional: update UI
    }

    @Override
    public void onWfbNgStatsChanged(WfbNGStats data) {
        // Optional: update UI
    }

    @Override
    public void onNewMavlinkData(MavlinkData data) {
        runOnUiThread(() -> osdManager.render(data));
    }

    @Override
    public void onChannelSettingChanged(int channel) {
        wfbLinkManager.setChannel(channel);
    }

    @Override
    public void onBandwidthSettingChanged(int bw) {
        wfbLinkManager.setBandwidth(bw);
    }

    private void startVpnService() {
        Intent intent = VpnService.prepare(this);
        if (intent != null) {
            try {
                startActivityForResult(intent, VPN_REQUEST_CODE);
            } catch (Exception ignored) { }
        } else {
            Intent serviceIntent = new Intent(this, WfbNgVpnService.class);
            try { startService(serviceIntent); } catch (Exception ignored) { }
        }
    }

    // --- gs.key helpers (mirroring VideoActivity) ---
    private void setDefaultGsKey() {
        if (getGsKey().length > 0) {
            Log.d(TAG, "gs.key already saved in preferences.");
            return;
        }
        try {
            Log.d(TAG, "Importing default gs.key...");
            java.io.InputStream inputStream = getAssets().open("gs.key");
            setGsKey(inputStream);
            inputStream.close();
        } catch (Exception e) {
            Log.e(TAG, "Failed to import default gs.key", e);
        }
    }

    private byte[] getGsKey() {
        String pref = getSharedPreferences("general", Context.MODE_PRIVATE).getString("gs.key", "");
        return android.util.Base64.decode(pref, android.util.Base64.DEFAULT);
    }

    private void setGsKey(java.io.InputStream inputStream) throws java.io.IOException {
        byte[] buffer = new byte[inputStream.available()];
        int bytesRead = inputStream.read(buffer);
        if (bytesRead == -1) {
            Log.e(TAG, "Failed to read gs.key from stream");
            return;
        }
        String pref = android.util.Base64.encodeToString(buffer, android.util.Base64.DEFAULT);
        android.content.SharedPreferences prefs = getSharedPreferences("general", Context.MODE_PRIVATE);
        android.content.SharedPreferences.Editor editor = prefs.edit();
        editor.putString("gs.key", pref);
        editor.apply();
    }

    private void copyGSKey() {
        java.io.File file = new java.io.File(getApplicationContext().getFilesDir(), "gs.key");
        java.io.OutputStream out = null;
        try {
            byte[] keyBytes = getGsKey();
            Log.d(TAG, "Using gs.key; copying to " + file.getAbsolutePath());
            out = new java.io.FileOutputStream(file);
            out.write(keyBytes, 0, keyBytes.length);
        } catch (Exception e) {
            Log.e(TAG, "Failed to copy gs.key", e);
        } finally {
            if (out != null) try { out.close(); } catch (Exception ignored) {}
        }
    }

    private static String safeWirelessInfo(Context ctx) {
        try {
            android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null || wm.getConnectionInfo() == null) return null;
            int address = wm.getConnectionInfo().getIpAddress();
            if (address == 0) return null;
            return android.text.format.Formatter.formatIpAddress(address);
        } catch (Throwable t) {
            return null;
        }
    }
}

#pragma once

#include <string>
#include <thread>
#include <atomic>
#include <functional>
#include <chrono>
#include <mutex>
#include <cstdint>
#include <android/log.h>
#include <jni.h>

class DeviceClient {
public:
    struct StartLineState {
        std::string status;
        int64_t armed_at;
        int64_t countdown_started_at;
        int step_interval_ms;
        int led_count;
    };
    
    // Constructor
    DeviceClient(const std::string& backend_url, const std::string& device_name = "FPVue Device", JavaVM* jvm = nullptr);
    
    // Destructor
    ~DeviceClient();
    
    // Start the device client
    void start();
    
    // Stop the device client
    void stop();
    
    // Get current WiFi channel
    int getCurrentWifiChannel() const;
    
    // Get device identifier (MAC/Serial/UUID)
    std::string getDeviceIdentifier() const;
    
    // Get MAC address (legacy)
    std::string getMacAddress() const;
    
    // Get connection status
    bool isConnected() const;
    
    // Get last successful connection time
    std::chrono::time_point<std::chrono::steady_clock> getLastConnectionTime() const;
    
    // Get backend URL
    const std::string& getBackendUrl() const { return backend_url_; }
    
    // Session management
    bool isSessionActive() const;
    int getSessionTimeRemaining() const; // Returns remaining time in seconds
    std::string getSessionTimeString() const; // Returns formatted MM:SS string
    std::string getSessionPilotName() const;
    std::string getSessionPackageLabel() const;
    int getSessionAllocatedMinutes() const;
    std::string getCurrentSessionId() const;
    
    // Set WiFi channel change callback
    void setChannelChangeCallback(std::function<void(int)> callback);

    // Report local WiFi channel (updates backend & internal state)
    void reportLocalWifiChannel(int channel);
    
    // Set status updates callback
    void setStatusCallback(std::function<void(bool, int, const std::string&)> callback);
    
    // Set display mode change callback
    void setDisplayModeChangeCallback(std::function<void(const std::string&)> callback);
    
    // Set start line state callback
    void setStartLineCallback(std::function<void(const StartLineState&)> callback);
    
    // Get current display mode
    std::string getCurrentDisplayMode() const;
    
    // Get current start line state
    StartLineState getStartLineState() const;
    
    // Update device status
    void updateStatus(const std::string& status);
    
    // Battery status methods
    int getBatteryLevel() const;
    bool isBatteryCharging() const;
    void updateBatteryStatus(int level, bool charging);
    const std::string& getLastRegisterPayload() const { return last_register_payload_; }
    
    // HTTP client for external use (e.g., SessionUploader)
    std::string makeHttpRequest(const std::string& url, const std::string& method, const std::string& data = "");

private:
    // Configuration
    std::string backend_url_;
    std::string device_name_;
    std::string device_identifier_;
    std::string mac_address_;
    JavaVM* jvm_;
    std::atomic<int> current_wifi_channel_;
    std::atomic<int> pending_wifi_channel_update_;
    std::atomic<int64_t> last_local_channel_report_ms_;
    std::string current_display_mode_;
    std::atomic<bool> running_;
    
    // Connection status tracking
    std::atomic<bool> connected_;
    std::chrono::time_point<std::chrono::steady_clock> last_connection_time_;
    
    // Session management
    std::atomic<bool> session_active_;
    std::atomic<int> session_remaining_;
    std::atomic<int> session_allocated_minutes_;
    std::string session_pilot_name_;
    std::string session_package_label_;
    std::string current_session_id_;
    mutable std::mutex session_mutex_;

    // Battery status
    std::atomic<int> battery_level_;
    std::atomic<bool> battery_charging_;
    std::string last_register_payload_;
    
    // Threading
    std::thread heartbeat_thread_;
    
    // Callback for WiFi channel changes
    std::function<void(int)> channel_change_callback_;
    
    // Callback for status updates
    std::function<void(bool, int, const std::string&)> status_callback_;
    
    // Callback for display mode changes
    std::function<void(const std::string&)> display_mode_change_callback_;
    std::function<void(const StartLineState&)> start_line_callback_;
    
    StartLineState start_line_state_;
    StartLineState last_notified_start_line_state_;
    bool start_line_state_initialized_ = false;
    mutable std::mutex start_line_mutex_;
    std::string last_config_response_;
    
    // Private methods
    void heartbeatLoop();
    void notifyStatus();
    bool registerDevice();
    int getWifiChannelFromBackend();
    std::string getDisplayModeFromBackend();
    std::string fetchDeviceConfig();
    std::string getMacAddressFromSystem();
    std::string getDeviceSerial();
    std::string getHardwareIdentifier();
    std::string getBuildField(JNIEnv* env, jclass buildClass, const char* fieldName);
    std::string getInstallationUUID();
    std::string generateHybridIdentifier();
    void updateSessionInfo();
    bool parseStartLineState(const std::string& json, StartLineState& outState);
    void updateStartLineStateInternal(const StartLineState& state);
    bool sendWifiChannelUpdate(int channel);
    
    // Android specific methods
    std::string getAndroidMacAddress();
    void saveInstallationUUID(const std::string& uuid);
    std::string loadInstallationUUID();
    
    // Quest 3 detection
    bool isQuest3Device();
    std::string getDeviceModel();
    
    // Logging
    void logInfo(const std::string& message);
    void logError(const std::string& message);
};

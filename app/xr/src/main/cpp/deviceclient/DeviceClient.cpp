#include "DeviceClient.h"
#include "config.h"
#include <sstream>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <unistd.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <string.h>
#include <ifaddrs.h>
#include <netpacket/packet.h>
#include <android/log.h>
#include <jni.h>
#include <fstream>
#include <sys/stat.h>
#include <android/native_activity.h>
#include <iomanip>
#include <cctype>

#define LOG_TAG "DeviceClient"

namespace {
    constexpr int kDefaultStartLineLedCount = 5;

    void trimSpaces(const std::string& text, size_t& index) {
        while (index < text.size() && std::isspace(static_cast<unsigned char>(text[index]))) {
            ++index;
        }
    }

    bool extractJsonObject(const std::string& json, const std::string& key, std::string& out) {
        std::string pattern = "\"" + key + "\"";
        size_t pos = json.find(pattern);
        if (pos == std::string::npos) {
            return false;
        }
        pos = json.find('{', pos);
        if (pos == std::string::npos) {
            return false;
        }
        size_t end = pos + 1;
        int depth = 1;
        while (end < json.size() && depth > 0) {
            if (json[end] == '{') {
                depth++;
            } else if (json[end] == '}') {
                depth--;
            }
            ++end;
        }
        if (depth != 0 || end > json.size()) {
            return false;
        }
        out = json.substr(pos, end - pos);
        return true;
    }

    std::string extractRawValue(const std::string& json, const std::string& key) {
        std::string pattern = "\"" + key + "\"";
        size_t pos = json.find(pattern);
        if (pos == std::string::npos) {
            return {};
        }
        pos = json.find(':', pos);
        if (pos == std::string::npos) {
            return {};
        }
        ++pos;
        trimSpaces(json, pos);
        if (pos >= json.size()) {
            return {};
        }
        if (json[pos] == '"') {
            ++pos;
            std::string result;
            while (pos < json.size()) {
                char c = json[pos];
                if (c == '\\') {
                    if (pos + 1 < json.size()) {
                        result.push_back(json[pos + 1]);
                        pos += 2;
                        continue;
                    }
                    break;
                }
                if (c == '"') {
                    return result;
                }
                result.push_back(c);
                ++pos;
            }
            return result;
        }

        size_t end = pos;
        while (end < json.size() && json[end] != ',' && json[end] != '}' &&
               !std::isspace(static_cast<unsigned char>(json[end]))) {
            ++end;
        }
        return json.substr(pos, end - pos);
    }

    long long extractLongValue(const std::string& json, const std::string& key, long long defaultValue) {
        std::string raw = extractRawValue(json, key);
        if (raw.empty() || raw == "null") {
            return defaultValue;
        }
        try {
            return std::stoll(raw);
        } catch (...) {
            return defaultValue;
        }
    }

    int extractIntValue(const std::string& json, const std::string& key, int defaultValue) {
        return static_cast<int>(extractLongValue(json, key, defaultValue));
    }

    std::string extractStringValue(const std::string& json, const std::string& key, const std::string& defaultValue) {
        std::string value = extractRawValue(json, key);
        if (value.empty()) {
            return defaultValue;
        }
        return value;
    }
}

DeviceClient::DeviceClient(const std::string& backend_url, const std::string& device_name, JavaVM* jvm)
    : backend_url_(backend_url), device_name_(device_name), jvm_(jvm), current_wifi_channel_(-1),
      pending_wifi_channel_update_(-1), last_local_channel_report_ms_(0),
      current_display_mode_("triple"), running_(false), connected_(false), session_active_(false),
      session_remaining_(0), session_allocated_minutes_(0), battery_level_(-1), battery_charging_(false) {
    
    // Get hybrid device identifier
    device_identifier_ = generateHybridIdentifier();
    
    // Get MAC address for legacy compatibility
    mac_address_ = getMacAddressFromSystem();
    if (mac_address_.empty()) {
        mac_address_ = "unknown";
    }
    
    // Initialize connection time to epoch
    last_connection_time_ = std::chrono::steady_clock::time_point{};
    
    logInfo("DeviceClient initialized with identifier: " + device_identifier_);
    
    // Detect Quest 3 device and log result
    if (isQuest3Device()) {
        logInfo("=== QUEST 3 DEVICE DETECTED! ===");
    } else {
        logInfo("Quest 2 or other device detected");
    }

    start_line_state_ = {"idle", 0, 0, 1000, kDefaultStartLineLedCount};
    last_notified_start_line_state_ = start_line_state_;
    start_line_state_initialized_ = true;
}

DeviceClient::~DeviceClient() {
    stop();
}

void DeviceClient::start() {
    if (running_.load()) {
        logInfo("DeviceClient already running");
        return;
    }
    
    running_ = true;
    heartbeat_thread_ = std::thread(&DeviceClient::heartbeatLoop, this);
    
    logInfo("DeviceClient started");
}

void DeviceClient::stop() {
    if (!running_.load()) {
        return;
    }
    
    running_ = false;
    if (heartbeat_thread_.joinable()) {
        heartbeat_thread_.join();
    }
    
    logInfo("DeviceClient stopped");
}

int DeviceClient::getCurrentWifiChannel() const {
    return current_wifi_channel_.load();
}

std::string DeviceClient::getDeviceIdentifier() const {
    return device_identifier_;
}

std::string DeviceClient::getMacAddress() const {
    return mac_address_;
}

bool DeviceClient::isConnected() const {
    if (!connected_.load()) {
        return false;
    }
    
    // Consider connection expired if no successful communication for 30 seconds
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(now - last_connection_time_).count();
    return elapsed < 30;
}

std::chrono::time_point<std::chrono::steady_clock> DeviceClient::getLastConnectionTime() const {
    return last_connection_time_;
}

bool DeviceClient::isSessionActive() const {
    return session_active_.load();
}

int DeviceClient::getSessionTimeRemaining() const {
    return session_remaining_.load();
}

std::string DeviceClient::getSessionTimeString() const {
    int remaining = session_remaining_.load();
    if (remaining <= 0) {
        return "00:00";
    }
    
    int minutes = remaining / 60;
    int seconds = remaining % 60;
    
    std::ostringstream oss;
    oss << std::setfill('0') << std::setw(2) << minutes << ":" 
        << std::setfill('0') << std::setw(2) << seconds;
    return oss.str();
}

std::string DeviceClient::getSessionPilotName() const {
    std::lock_guard<std::mutex> lock(session_mutex_);
    return session_pilot_name_;
}

std::string DeviceClient::getSessionPackageLabel() const {
    std::lock_guard<std::mutex> lock(session_mutex_);
    return session_package_label_;
}

int DeviceClient::getSessionAllocatedMinutes() const {
    return session_allocated_minutes_.load();
}

std::string DeviceClient::getCurrentSessionId() const {
    std::lock_guard<std::mutex> lock(session_mutex_);
    return current_session_id_;
}

void DeviceClient::setChannelChangeCallback(std::function<void(int)> callback) {
    channel_change_callback_ = callback;
}

void DeviceClient::reportLocalWifiChannel(int channel) {
    if (channel <= 0) {
        return;
    }

    int previous = current_wifi_channel_.exchange(channel);
    if (previous == channel) {
        return;
    }

    logInfo("Reporting local WiFi channel: " + std::to_string(channel));
    pending_wifi_channel_update_.store(channel);
    auto now = std::chrono::steady_clock::now();
    int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
    last_local_channel_report_ms_.store(nowMs);
    notifyStatus();
}

void DeviceClient::setStatusCallback(std::function<void(bool, int, const std::string&)> callback) {
    status_callback_ = std::move(callback);
}

void DeviceClient::setDisplayModeChangeCallback(std::function<void(const std::string&)> callback) {
    display_mode_change_callback_ = callback;
}

void DeviceClient::setStartLineCallback(std::function<void(const StartLineState&)> callback) {
    StartLineState stateCopy;
    bool hasState = false;
    {
        std::lock_guard<std::mutex> lock(start_line_mutex_);
        start_line_callback_ = std::move(callback);
        if (start_line_callback_ && start_line_state_initialized_) {
            stateCopy = start_line_state_;
            last_notified_start_line_state_ = start_line_state_;
            hasState = true;
        }
    }
    if (hasState && start_line_callback_) {
        start_line_callback_(stateCopy);
    }
}

DeviceClient::StartLineState DeviceClient::getStartLineState() const {
    std::lock_guard<std::mutex> lock(start_line_mutex_);
    return start_line_state_;
}

std::string DeviceClient::getCurrentDisplayMode() const {
    return current_display_mode_;
}

void DeviceClient::updateStatus(const std::string& status) {
    // This could be used to update device status in the future
    logInfo("Status updated: " + status);
}

int DeviceClient::getBatteryLevel() const {
    return battery_level_.load();
}

bool DeviceClient::isBatteryCharging() const {
    return battery_charging_.load();
}

void DeviceClient::updateBatteryStatus(int level, bool charging) {
    battery_level_ = level;
    battery_charging_ = charging;
    notifyStatus();
}

bool DeviceClient::sendWifiChannelUpdate(int channel) {
    if (channel <= 0) {
        return false;
    }

    std::ostringstream payload;
    payload << "{\"wifi_channel\":" << channel << "}";
    std::string url = backend_url_ + "/api/devices/" + device_identifier_ + "/wifi-channel";
    std::string response = makeHttpRequest(url, "PUT", payload.str());
    return !response.empty();
}

void DeviceClient::heartbeatLoop() {
    while (running_.load()) {
        try {
            // Register/update device status
            if (registerDevice()) {
                logInfo("Device registered successfully");
            } else {
                logError("Failed to register device");
            }

            int pendingChannel = pending_wifi_channel_update_.exchange(-1);
            if (pendingChannel > 0) {
                bool updated = sendWifiChannelUpdate(pendingChannel);
                if (!updated) {
                    logError("Failed to push WiFi channel " + std::to_string(pendingChannel) + " to backend; will retry");
                    pending_wifi_channel_update_.store(pendingChannel);
                } else {
                    logInfo("Reported WiFi channel " + std::to_string(pendingChannel) + " to backend");
                }
            }
            
            // Check for configuration changes
            int new_channel = getWifiChannelFromBackend();
            if (new_channel > 0) {
                int currentChannel = current_wifi_channel_.load();
                int pending = pending_wifi_channel_update_.load();
                bool allowUpdate = (pending <= 0) || (new_channel == pending);
                if (allowUpdate) {
                    auto now = std::chrono::steady_clock::now();
                    int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
                    int64_t lastLocalMs = last_local_channel_report_ms_.load();
                    bool recentlyReported = (lastLocalMs > 0) && ((nowMs - lastLocalMs) < 5000);
                    if (!recentlyReported && new_channel != currentChannel) {
                        logInfo("WiFi channel change detected: " + std::to_string(currentChannel) + " -> " + std::to_string(new_channel));
                        current_wifi_channel_ = new_channel;
                        if (channel_change_callback_) {
                            channel_change_callback_(new_channel);
                        }
                        notifyStatus();
                    }
                }
            }
            
            // Check for display mode changes
            std::string new_display_mode = getDisplayModeFromBackend();
            if (!new_display_mode.empty() && new_display_mode != current_display_mode_) {
                logInfo("Display mode change detected: " + current_display_mode_ + " -> " + new_display_mode);
                
                current_display_mode_ = new_display_mode;
                
                // Call the callback if set
                if (display_mode_change_callback_) {
                    display_mode_change_callback_(new_display_mode);
                }
                notifyStatus();
            }
            
            // Update session information
            updateSessionInfo();
            notifyStatus();
            
        } catch (const std::exception& e) {
            logError("Error in heartbeat loop: " + std::string(e.what()));
        }
        
        // Wait 1 second before next heartbeat
        for (int i = 0; i < 10 && running_.load(); ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }
}

bool DeviceClient::registerDevice() {
    int battery_level = battery_level_.load();
    bool battery_charging = battery_charging_.load();
    
    std::stringstream json_data;
    json_data << "{"
        << "\"device_id\":\"" << device_identifier_ << "\","
        << "\"mac_address\":\"" << mac_address_ << "\","
        << "\"device_name\":\"" << device_name_ << "\"";
    
    // Include battery data if available
    if (battery_level >= 0) {
        json_data << ",\"battery_level\":" << battery_level;
        json_data << ",\"battery_charging\":" << (battery_charging ? "true" : "false");
    }
    
    int wifi_channel = current_wifi_channel_.load();
    if (wifi_channel > 0) {
        json_data << ",\"wifi_channel\":" << wifi_channel;
    }
    json_data << "}";
    
    last_register_payload_ = json_data.str();

    std::string url = backend_url_ + "/api/devices/register";
    std::string response = makeHttpRequest(url, "POST", last_register_payload_);
    
    bool success = !response.empty();
    if (success) {
        connected_ = true;
        last_connection_time_ = std::chrono::steady_clock::now();
        logInfo("Device registration successful - backend connected");
        notifyStatus();
    } else {
        connected_ = false;
        logError("Device registration failed - backend disconnected");
        notifyStatus();
    }
    
    return success;
}

int DeviceClient::getWifiChannelFromBackend() {
    std::string response = fetchDeviceConfig();
    if (response.empty()) {
        return current_wifi_channel_.load();
    }

    size_t pos = response.find("\"wifi_channel\"");
    if (pos != std::string::npos) {
        pos = response.find(":", pos);
        if (pos != std::string::npos) {
            ++pos;
            while (pos < response.size() && std::isspace(static_cast<unsigned char>(response[pos]))) {
                ++pos;
            }
            size_t endPos = response.find_first_of(",}", pos);
            if (endPos != std::string::npos) {
                std::string channelStr = response.substr(pos, endPos - pos);
                try {
                    return std::stoi(channelStr);
                } catch (const std::exception& e) {
                    logError("Error parsing WiFi channel: " + std::string(e.what()));
                }
            }
        }
    }

    return current_wifi_channel_.load();
}




void DeviceClient::notifyStatus() {
    if (status_callback_) {
        status_callback_(connected_.load(), current_wifi_channel_.load(), current_display_mode_);
    }
}


std::string DeviceClient::getDisplayModeFromBackend() {
    std::string response = last_config_response_;
    if (response.empty()) {
        response = fetchDeviceConfig();
        if (response.empty()) {
            return current_display_mode_;
        }
    }

    size_t pos = response.find("\"display_mode\"");
    if (pos != std::string::npos) {
        pos = response.find(':', pos);
        if (pos != std::string::npos) {
            ++pos;
            while (pos < response.size() && std::isspace(static_cast<unsigned char>(response[pos]))) {
                ++pos;
            }
            if (pos < response.size() && response[pos] == '"') {
                ++pos;
                size_t endPos = response.find('"', pos);
                if (endPos != std::string::npos) {
                    return response.substr(pos, endPos - pos);
                }
            }
        }
    }

    return current_display_mode_;
}




std::string DeviceClient::fetchDeviceConfig() {
    std::string url = backend_url_ + "/api/devices/" + device_identifier_ + "/config";
    std::string response = makeHttpRequest(url, "GET");

    if (response.empty()) {
        connected_ = false;
        return {};
    }

    connected_ = true;
    last_connection_time_ = std::chrono::steady_clock::now();
    last_config_response_ = response;

    std::string startLineJson;
    if (extractJsonObject(response, "start_line", startLineJson)) {
        StartLineState parsedState;
        if (parseStartLineState(startLineJson, parsedState)) {
            updateStartLineStateInternal(parsedState);
        }
    }

    return response;
}


bool DeviceClient::parseStartLineState(const std::string& json, StartLineState& outState) {
    StartLineState state{};
    state.status = extractStringValue(json, "status", "idle");
    state.step_interval_ms = extractIntValue(json, "step_interval_ms", 1000);
    state.led_count = extractIntValue(json, "led_count", kDefaultStartLineLedCount);
    state.armed_at = extractLongValue(json, "armed_at", 0);
    state.countdown_started_at = extractLongValue(json, "countdown_started_at", 0);

    outState = state;
    return true;
}

void DeviceClient::updateStartLineStateInternal(const StartLineState& state) {
    std::function<void(const StartLineState&)> callback;
    StartLineState stateCopy;

    auto equals = [](const StartLineState& a, const StartLineState& b) {
        return a.status == b.status &&
               a.armed_at == b.armed_at &&
               a.countdown_started_at == b.countdown_started_at &&
               a.step_interval_ms == b.step_interval_ms &&
               a.led_count == b.led_count;
    };

    bool shouldNotify = false;
    {
        std::lock_guard<std::mutex> lock(start_line_mutex_);
        bool changed = !start_line_state_initialized_ || !equals(start_line_state_, state);
        start_line_state_ = state;
        start_line_state_initialized_ = true;

        if (changed && (!equals(last_notified_start_line_state_, state))) {
            last_notified_start_line_state_ = state;
            shouldNotify = start_line_callback_ != nullptr;
            if (shouldNotify) {
                callback = start_line_callback_;
                stateCopy = state;
            }
        }
    }

    if (shouldNotify && callback) {
        callback(stateCopy);
    }
}

std::string DeviceClient::getMacAddressFromSystem() {
    struct ifaddrs *ifap, *ifa;
    char mac_str[18];
    
    if (getifaddrs(&ifap) == -1) {
        logError("Failed to get network interfaces");
        return "";
    }
    
    for (ifa = ifap; ifa != NULL; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family == AF_PACKET) {
            struct sockaddr_ll* s = (struct sockaddr_ll*)ifa->ifa_addr;
            
            // Skip loopback and look for wlan interfaces
            if (s->sll_halen == 6 && strncmp(ifa->ifa_name, "wlan", 4) == 0) {
                snprintf(mac_str, sizeof(mac_str), "%02x:%02x:%02x:%02x:%02x:%02x",
                        s->sll_addr[0], s->sll_addr[1], s->sll_addr[2],
                        s->sll_addr[3], s->sll_addr[4], s->sll_addr[5]);
                freeifaddrs(ifap);
                return std::string(mac_str);
            }
        }
    }
    
    freeifaddrs(ifap);
    
    // Fallback: try to get any MAC address
    if (getifaddrs(&ifap) == -1) {
        return "";
    }
    
    for (ifa = ifap; ifa != NULL; ifa = ifa->ifa_next) {
        if (ifa->ifa_addr && ifa->ifa_addr->sa_family == AF_PACKET) {
            struct sockaddr_ll* s = (struct sockaddr_ll*)ifa->ifa_addr;
            
            // Skip loopback
            if (s->sll_halen == 6 && strcmp(ifa->ifa_name, "lo") != 0) {
                snprintf(mac_str, sizeof(mac_str), "%02x:%02x:%02x:%02x:%02x:%02x",
                        s->sll_addr[0], s->sll_addr[1], s->sll_addr[2],
                        s->sll_addr[3], s->sll_addr[4], s->sll_addr[5]);
                freeifaddrs(ifap);
                return std::string(mac_str);
            }
        }
    }
    
    freeifaddrs(ifap);
    return "";
}

std::string DeviceClient::makeHttpRequest(const std::string& url, const std::string& method, const std::string& data) {
    // Simple HTTP client implementation using Android's built-in capabilities
    // This is a basic implementation - in production, consider using a proper HTTP library
    
    std::string response;
    
    // Extract host and path from URL
    std::string host, path;
    size_t proto_pos = url.find("://");
    if (proto_pos != std::string::npos) {
        size_t start = proto_pos + 3;
        size_t path_pos = url.find('/', start);
        if (path_pos != std::string::npos) {
            host = url.substr(start, path_pos - start);
            path = url.substr(path_pos);
        } else {
            host = url.substr(start);
            path = "/";
        }
    }
    
    // Extract port
    int port = 80;
    size_t port_pos = host.find(':');
    if (port_pos != std::string::npos) {
        port = std::stoi(host.substr(port_pos + 1));
        host = host.substr(0, port_pos);
    }
    
    // Create socket
    int sockfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sockfd < 0) {
        logError("Failed to create socket");
        return "";
    }
    
    // Set socket timeout
    struct timeval timeout;
    timeout.tv_sec = 5;
    timeout.tv_usec = 0;
    setsockopt(sockfd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(sockfd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    
    // Connect to server
    struct sockaddr_in server_addr;
    memset(&server_addr, 0, sizeof(server_addr));
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(port);
    
    // Try to resolve hostname or use IP address
    if (inet_pton(AF_INET, host.c_str(), &server_addr.sin_addr) <= 0) {
        // If not a valid IP, try basic hostname resolution
        // For Android, you might need to use getaddrinfo() for proper DNS resolution
        // For now, log the error and return empty response
        logError("Invalid address or hostname resolution failed: " + host);
        close(sockfd);
        return "";
    }
    
    if (connect(sockfd, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
        logError("Connection failed to " + host + ":" + std::to_string(port));
        close(sockfd);
        return "";
    }
    
    // Build HTTP request
    std::ostringstream request;
    request << method << " " << path << " HTTP/1.1\r\n";
    request << "Host: " << host << "\r\n";
    request << "User-Agent: FPVue/1.0\r\n";
    
    if (method == "POST" || method == "PUT") {
        request << "Content-Type: application/json\r\n";
        request << "Content-Length: " << data.length() << "\r\n";
    }
    
    request << "Connection: close\r\n\r\n";
    
    if (!data.empty()) {
        request << data;
    }
    
    std::string request_str = request.str();
    
    // Send request
    if (send(sockfd, request_str.c_str(), request_str.length(), 0) < 0) {
        logError("Failed to send request");
        close(sockfd);
        return "";
    }
    
    // Read response
    char buffer[4096];
    ssize_t bytes_read;
    std::string full_response;
    
    while ((bytes_read = recv(sockfd, buffer, sizeof(buffer) - 1, 0)) > 0) {
        buffer[bytes_read] = '\0';
        full_response += buffer;
    }
    
    close(sockfd);
    
    // Extract body from HTTP response
    size_t body_pos = full_response.find("\r\n\r\n");
    if (body_pos != std::string::npos) {
        response = full_response.substr(body_pos + 4);
    }
    
    return response;
}

void DeviceClient::updateSessionInfo() {
    std::string url = backend_url_ + "/api/devices/" + device_identifier_ + "/session";
    std::string response = makeHttpRequest(url, "GET");
    
    if (response.empty()) {
        session_active_ = false;
        session_remaining_ = 0;
        session_allocated_minutes_.store(0);
        {
            std::lock_guard<std::mutex> lock(session_mutex_);
            session_pilot_name_.clear();
            session_package_label_.clear();
            current_session_id_.clear();
        }
        return;
    }

    int remainingSeconds = extractIntValue(response, "remaining", 0);
    session_remaining_ = remainingSeconds;
    bool is_active = extractRawValue(response, "is_active") == "true" && remainingSeconds > 0;
    session_active_ = is_active;

    int packageMinutes = extractIntValue(response, "package_minutes", 0);
    session_allocated_minutes_.store(packageMinutes);

    const std::string pilotName = extractStringValue(response, "pilot_name", "");
    const std::string packageLabel = extractStringValue(response, "package_label", "");
    const std::string sessionId = extractStringValue(response, "session_id", "");

    {
        std::lock_guard<std::mutex> lock(session_mutex_);
        session_pilot_name_ = pilotName;
        session_package_label_ = packageLabel;
        current_session_id_ = sessionId;
    }
}

void DeviceClient::logInfo(const std::string& message) {
    __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "%s", message.c_str());
}

std::string DeviceClient::generateHybridIdentifier() {
    // Try device serial number first
    std::string serial = getDeviceSerial();
    if (!serial.empty() && serial != "unknown" && serial != "UNKNOWN") {
        logInfo("Using device serial as identifier: " + serial.substr(0, 8) + "...");
        return "SERIAL:" + serial;
    }
    
    // If serial is not available, create a hardware-based identifier
    logError("Device serial number not available, generating hardware-based identifier");
    
    // Use a combination of Build fields that are more persistent
    std::string hardwareId = getHardwareIdentifier();
    if (!hardwareId.empty()) {
        logInfo("Using hardware identifier: " + hardwareId.substr(0, 16) + "...");
        return "HARDWARE:" + hardwareId;
    }
    
    // Last resort - use persistent UUID
    std::string uuid = getInstallationUUID();
    logInfo("Using installation UUID as identifier: " + uuid);
    return "UUID:" + uuid;
}

std::string DeviceClient::getDeviceSerial() {
    // Use JNI to get android.os.Build.SERIAL
    if (jvm_ == nullptr) {
        logError("JavaVM not available for serial access");
        return "";
    }
    
    JavaVM* jvm = jvm_;
    JNIEnv* env = nullptr;
    bool threadAttached = false;
    
    logInfo("Attempting to get device serial number via JNI");
    
    // Get JNIEnv from JavaVM
    jint result = jvm->GetEnv((void**)&env, JNI_VERSION_1_6);
    if (result == JNI_EDETACHED) {
        logInfo("Thread not attached, attaching to JVM");
        result = jvm->AttachCurrentThread(&env, nullptr);
        if (result != JNI_OK || env == nullptr) {
            logError("Failed to attach thread to JVM for serial access");
            return "";
        }
        threadAttached = true;
    } else if (result != JNI_OK) {
        logError("Failed to get JNIEnv for serial access, result: " + std::to_string(result));
        return "";
    }
    
    logInfo("Successfully got JNIEnv, attempting to access Build class");
    
    std::string serial = "";
    
    try {
        // Get Build class
        jclass buildClass = env->FindClass("android/os/Build");
        if (buildClass == nullptr) {
            logError("Could not find android.os.Build class");
            if (env->ExceptionCheck()) {
                env->ExceptionDescribe();
                env->ExceptionClear();
            }
            if (threadAttached) {
                jvm->DetachCurrentThread();
            }
            return "";
        }
        
        logInfo("Successfully found Build class");
        
        // Try Build.SERIAL first (available on most devices)
        jfieldID serialField = env->GetStaticFieldID(buildClass, "SERIAL", "Ljava/lang/String;");
        if (serialField != nullptr) {
            logInfo("Found Build.SERIAL field");
            jstring serialJString = (jstring)env->GetStaticObjectField(buildClass, serialField);
            if (serialJString != nullptr) {
                const char* serialChars = env->GetStringUTFChars(serialJString, nullptr);
                if (serialChars != nullptr) {
                    serial = std::string(serialChars);
                    env->ReleaseStringUTFChars(serialJString, serialChars);
                    logInfo("Retrieved Build.SERIAL: " + serial.substr(0, 8) + "...");
                } else {
                    logError("Could not get UTF chars from serial string");
                }
                env->DeleteLocalRef(serialJString);
            } else {
                logError("Build.SERIAL field returned null");
            }
        } else {
            logError("Could not find Build.SERIAL field");
            if (env->ExceptionCheck()) {
                env->ExceptionDescribe();
                env->ExceptionClear();
            }
        }
        
        // If SERIAL is empty or "unknown", try getSerial() method (Android 9+)
        if (serial.empty() || serial == "unknown" || serial == "UNKNOWN") {
            logInfo("Build.SERIAL was empty or unknown, trying getSerial() method");
            jmethodID getSerialMethod = env->GetStaticMethodID(buildClass, "getSerial", "()Ljava/lang/String;");
            if (getSerialMethod != nullptr) {
                logInfo("Found Build.getSerial() method");
                jstring serialJString = (jstring)env->CallStaticObjectMethod(buildClass, getSerialMethod);
                if (env->ExceptionCheck()) {
                    logError("Exception calling getSerial() method");
                    env->ExceptionDescribe();
                    env->ExceptionClear();
                } else if (serialJString != nullptr) {
                    const char* serialChars = env->GetStringUTFChars(serialJString, nullptr);
                    if (serialChars != nullptr) {
                        serial = std::string(serialChars);
                        env->ReleaseStringUTFChars(serialJString, serialChars);
                        logInfo("Retrieved Build.getSerial(): " + serial.substr(0, 8) + "...");
                    }
                    env->DeleteLocalRef(serialJString);
                } else {
                    logError("Build.getSerial() returned null");
                }
            } else {
                logError("Could not find Build.getSerial() method");
                if (env->ExceptionCheck()) {
                    env->ExceptionDescribe();
                    env->ExceptionClear();
                }
            }
        }
        
        env->DeleteLocalRef(buildClass);
        
    } catch (...) {
        logError("Exception occurred while getting device serial");
    }
    
    if (threadAttached) {
        jvm->DetachCurrentThread();
    }
    
    if (!serial.empty() && serial != "unknown" && serial != "UNKNOWN") {
        logInfo("Successfully retrieved device serial: " + serial.substr(0, 8) + "...");
        return serial;
    } else {
        logInfo("Device serial not available or unknown");
        return "";
    }
}

std::string DeviceClient::getHardwareIdentifier() {
    // Create identifier from Build fields that are usually persistent
    if (jvm_ == nullptr) {
        logError("JavaVM not available for hardware identifier");
        return "";
    }
    
    JavaVM* jvm = jvm_;
    JNIEnv* env = nullptr;
    bool threadAttached = false;
    
    // Get JNIEnv from JavaVM
    jint result = jvm->GetEnv((void**)&env, JNI_VERSION_1_6);
    if (result == JNI_EDETACHED) {
        result = jvm->AttachCurrentThread(&env, nullptr);
        if (result != JNI_OK || env == nullptr) {
            logError("Failed to attach thread to JVM for hardware identifier");
            return "";
        }
        threadAttached = true;
    } else if (result != JNI_OK) {
        logError("Failed to get JNIEnv for hardware identifier");
        return "";
    }
    
    std::string hardwareId = "";
    
    try {
        // Get Build class
        jclass buildClass = env->FindClass("android/os/Build");
        if (buildClass == nullptr) {
            logError("Could not find android.os.Build class for hardware ID");
            if (threadAttached) {
                jvm->DetachCurrentThread();
            }
            return "";
        }
        
        // Get Build fields for unique hardware identifier
        std::string board = getBuildField(env, buildClass, "BOARD");
        std::string brand = getBuildField(env, buildClass, "BRAND");
        std::string model = getBuildField(env, buildClass, "MODEL");
        std::string device = getBuildField(env, buildClass, "DEVICE");
        std::string product = getBuildField(env, buildClass, "PRODUCT");
        std::string hardware = getBuildField(env, buildClass, "HARDWARE");
        std::string fingerprint = getBuildField(env, buildClass, "FINGERPRINT");
        
        env->DeleteLocalRef(buildClass);
        
        // Create a more unique hardware identifier
        if (!brand.empty() && !model.empty()) {
            // Use a combination of multiple fields for maximum uniqueness
            hardwareId = brand + "-" + model;
            
            // Add device-specific fields to ensure uniqueness
            if (!device.empty()) hardwareId += "-" + device;
            if (!product.empty()) hardwareId += "-" + product;
            if (!hardware.empty()) hardwareId += "-" + hardware;
            if (!board.empty()) hardwareId += "-" + board;
            
            // Use a hash of the full fingerprint instead of just the end
            if (!fingerprint.empty()) {
                // Create a simple hash of the fingerprint for uniqueness
                std::hash<std::string> hasher;
                size_t fpHash = hasher(fingerprint);
                hardwareId += "-" + std::to_string(fpHash % 1000000); // Use last 6 digits of hash
            }
            
            // Replace spaces and special chars with underscores
            for (char& c : hardwareId) {
                if (c == ' ' || c == '/' || c == '\\' || c == ':' || c == '=' || c == ',' || c == ';') {
                    c = '_';
                }
            }
            logInfo("Generated unique hardware identifier: " + hardwareId.substr(0, 32) + "...");
        }
        
    } catch (...) {
        logError("Exception occurred while getting hardware identifier");
    }
    
    if (threadAttached) {
        jvm->DetachCurrentThread();
    }
    
    return hardwareId;
}

std::string DeviceClient::getBuildField(JNIEnv* env, jclass buildClass, const char* fieldName) {
    jfieldID field = env->GetStaticFieldID(buildClass, fieldName, "Ljava/lang/String;");
    if (field == nullptr) {
        logError("Could not find Build." + std::string(fieldName) + " field");
        return "";
    }
    
    jstring fieldString = (jstring)env->GetStaticObjectField(buildClass, field);
    if (fieldString == nullptr) {
        logError("Build." + std::string(fieldName) + " field returned null");
        return "";
    }
    
    const char* fieldChars = env->GetStringUTFChars(fieldString, nullptr);
    if (fieldChars == nullptr) {
        env->DeleteLocalRef(fieldString);
        return "";
    }
    
    std::string result = std::string(fieldChars);
    env->ReleaseStringUTFChars(fieldString, fieldChars);
    env->DeleteLocalRef(fieldString);
    
    return result;
}

std::string DeviceClient::getInstallationUUID() {
    // Try to load existing UUID
    std::string uuid = loadInstallationUUID();
    if (!uuid.empty()) {
        return uuid;
    }
    
    // Generate new UUID (simple implementation)
    // In production, use a proper UUID library
    auto now = std::chrono::system_clock::now();
    auto timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
    
    // Seed random number generator
    srand(static_cast<unsigned int>(timestamp));
    
    std::ostringstream oss;
    oss << "fpvue-" << std::hex << (timestamp & 0xFFFFFF) << "-" << std::hex << (rand() % 0xFFFF);
    uuid = oss.str();
    
    // Save for future use
    saveInstallationUUID(uuid);
    
    logInfo("Generated new installation UUID: " + uuid);
    return uuid;
}

void DeviceClient::saveInstallationUUID(const std::string& uuid) {
    // Save to internal storage file
    std::string filepath = "/data/data/com.fpvue.xr/files/device_uuid.txt";
    
    // Create directory if it doesn't exist
    mkdir("/data/data/com.fpvue.xr/files", 0755);
    
    std::ofstream file(filepath);
    if (file.is_open()) {
        file << uuid;
        file.close();
        logInfo("Saved installation UUID to file: " + uuid);
    } else {
        logError("Failed to save installation UUID to file");
    }
}

std::string DeviceClient::loadInstallationUUID() {
    // Load from internal storage file
    std::string filepath = "/data/data/com.fpvue.xr/files/device_uuid.txt";
    
    std::ifstream file(filepath);
    if (file.is_open()) {
        std::string uuid;
        std::getline(file, uuid);
        file.close();
        
        if (!uuid.empty()) {
            logInfo("Loaded existing installation UUID from file: " + uuid);
            return uuid;
        }
    }
    
    logInfo("No existing installation UUID found");
    return "";
}

bool DeviceClient::isQuest3Device() {
    std::string deviceModel = getDeviceModel();
    bool isQuest3 = (deviceModel.find("Quest 3") != std::string::npos || 
                     deviceModel.find("MR2") != std::string::npos);
    
    logInfo("Quest 3 Detection: Device model = '" + deviceModel + "', is Quest 3 = " + (isQuest3 ? "YES" : "NO"));
    return isQuest3;
}

std::string DeviceClient::getDeviceModel() {
    if (jvm_ == nullptr) {
        logError("JavaVM not available for device model access");
        return "";
    }
    
    JavaVM* jvm = jvm_;
    JNIEnv* env = nullptr;
    bool threadAttached = false;
    std::string deviceModel = "";
    
    try {
        // Get JNIEnv from JavaVM
        jint result = jvm->GetEnv((void**)&env, JNI_VERSION_1_6);
        if (result == JNI_EDETACHED) {
            result = jvm->AttachCurrentThread(&env, nullptr);
            if (result != JNI_OK || env == nullptr) {
                logError("Failed to attach thread to JVM for device model access");
                return "";
            }
            threadAttached = true;
        } else if (result != JNI_OK) {
            logError("Failed to get JNIEnv for device model access");
            return "";
        }
        
        // Access android.os.Build.MODEL
        jclass buildClass = env->FindClass("android/os/Build");
        if (buildClass == nullptr) {
            logError("Could not find Build class for device model");
        } else {
            deviceModel = getBuildField(env, buildClass, "MODEL");
            env->DeleteLocalRef(buildClass);
            
            if (!deviceModel.empty()) {
                logInfo("Successfully retrieved device model: " + deviceModel);
            } else {
                logError("Device model is empty");
            }
        }
        
    } catch (...) {
        logError("Exception occurred while getting device model");
    }
    
    if (threadAttached) {
        jvm->DetachCurrentThread();
    }
    
    return deviceModel;
}

void DeviceClient::logError(const std::string& message) {
    __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, "%s", message.c_str());
}

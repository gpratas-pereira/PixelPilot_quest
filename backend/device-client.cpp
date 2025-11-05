/*
 * Device Client for FPVue VR App
 * This code should be integrated into the main FPVue app to communicate with the backend
 */

#include <curl/curl.h>
#include <json/json.h>
#include <string>
#include <thread>
#include <chrono>
#include <fstream>
#include <sys/socket.h>
#include <ifaddrs.h>
#include <netinet/in.h>
#include <net/if.h>

class DeviceClient {
private:
    std::string backend_url;
    std::string mac_address;
    std::string device_name;
    int current_wifi_channel;
    bool running;
    std::thread heartbeat_thread;

    // HTTP response callback
    static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
        ((std::string*)userp)->append((char*)contents, size * nmemb);
        return size * nmemb;
    }

    // Get MAC address of the device
    std::string getMacAddress() {
        struct ifaddrs *ifap, *ifa;
        char mac_str[18];
        
        if (getifaddrs(&ifap) == -1) {
            return "";
        }
        
        for (ifa = ifap; ifa != NULL; ifa = ifa->ifa_next) {
            if (ifa->ifa_addr && ifa->ifa_addr->sa_family == AF_PACKET) {
                struct sockaddr_ll* s = (struct sockaddr_ll*)ifa->ifa_addr;
                if (s->sll_halen == 6) {
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

    // Make HTTP request
    std::string makeRequest(const std::string& url, const std::string& method, const std::string& data = "") {
        CURL* curl;
        CURLcode res;
        std::string response_string;

        curl = curl_easy_init();
        if (curl) {
            curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_string);

            if (method == "POST" || method == "PUT") {
                curl_easy_setopt(curl, CURLOPT_POSTFIELDS, data.c_str());
                
                struct curl_slist* headers = NULL;
                headers = curl_slist_append(headers, "Content-Type: application/json");
                curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
                
                if (method == "PUT") {
                    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
                }
                
                curl_slist_free_all(headers);
            }

            res = curl_easy_perform(curl);
            curl_easy_cleanup(curl);
        }

        return response_string;
    }

    // Register device with backend
    bool registerDevice() {
        Json::Value json_data;
        json_data["mac_address"] = mac_address;
        json_data["device_name"] = device_name;

        Json::StreamWriterBuilder builder;
        std::string json_string = Json::writeString(builder, json_data);

        std::string url = backend_url + "/api/devices/register";
        std::string response = makeRequest(url, "POST", json_string);

        return !response.empty();
    }

    // Get configuration from backend
    int getWifiChannelFromBackend() {
        std::string url = backend_url + "/api/devices/" + mac_address + "/config";
        std::string response = makeRequest(url, "GET");

        if (response.empty()) {
            return current_wifi_channel; // Return current if request fails
        }

        Json::Value json_response;
        Json::Reader reader;
        if (reader.parse(response, json_response)) {
            return json_response["wifi_channel"].asInt();
        }

        return current_wifi_channel;
    }

    // Heartbeat loop
    void heartbeatLoop() {
        while (running) {
            // Register/update device status
            registerDevice();

            // Check for configuration changes
            int new_channel = getWifiChannelFromBackend();
            if (new_channel != current_wifi_channel) {
                updateWifiChannel(new_channel);
            }

            // Wait 10 seconds before next heartbeat
            std::this_thread::sleep_for(std::chrono::seconds(10));
        }
    }

    // Update WiFi channel (implement based on your WFB-ng setup)
    void updateWifiChannel(int new_channel) {
        // This is where you would implement the actual WiFi channel change
        // For WFB-ng, you might need to restart the service with new channel
        
        __android_log_print(ANDROID_LOG_INFO, "DeviceClient", 
                           "Updating WiFi channel from %d to %d", current_wifi_channel, new_channel);
        
        // Example: Update your WFB-ng configuration
        // system(("pkill wfb_tx && wfb_tx -c " + std::to_string(new_channel) + " &").c_str());
        
        current_wifi_channel = new_channel;
    }

public:
    DeviceClient(const std::string& backend_url, const std::string& device_name = "FPVue Device") 
        : backend_url(backend_url), device_name(device_name), current_wifi_channel(173), running(false) {
        
        // Get MAC address
        mac_address = getMacAddress();
        if (mac_address.empty()) {
            mac_address = "unknown";
        }
    }

    ~DeviceClient() {
        stop();
    }

    // Start the device client
    void start() {
        if (running) return;

        running = true;
        heartbeat_thread = std::thread(&DeviceClient::heartbeatLoop, this);
        
        __android_log_print(ANDROID_LOG_INFO, "DeviceClient", 
                           "Device client started. MAC: %s", mac_address.c_str());
    }

    // Stop the device client
    void stop() {
        if (!running) return;

        running = false;
        if (heartbeat_thread.joinable()) {
            heartbeat_thread.join();
        }
        
        __android_log_print(ANDROID_LOG_INFO, "DeviceClient", "Device client stopped");
    }

    // Get current WiFi channel
    int getCurrentWifiChannel() const {
        return current_wifi_channel;
    }

    // Get MAC address
    std::string getMacAddressString() const {
        return mac_address;
    }
};

/*
 * Integration example for app.cpp:
 * 
 * // Add to global variables
 * DeviceClient* device_client = nullptr;
 * 
 * // Add to app_init():
 * device_client = new DeviceClient("http://your-backend-server:3000", "FPVue Device");
 * device_client->start();
 * 
 * // Add to app_exit():
 * if (device_client) {
 *     device_client->stop();
 *     delete device_client;
 * }
 * 
 * // In your WFB-ng initialization, use:
 * int channel = device_client ? device_client->getCurrentWifiChannel() : 173;
 */
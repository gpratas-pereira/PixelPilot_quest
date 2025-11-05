#pragma once

// Device Client Configuration
// Update this URL to point to your backend server

// Default backend URL - change this to your server's IP
#define DEFAULT_BACKEND_URL "http://192.168.68.58:3000"

// Device name prefix
#define DEVICE_NAME_PREFIX "FPVue VR Device"

// Network settings
#define HTTP_TIMEOUT_SECONDS 5
#define HEARTBEAT_INTERVAL_SECONDS 10
#define MAX_RETRIES 3

// Debug logging
#define DEVICE_CLIENT_DEBUG 1
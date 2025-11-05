# FPVue VR App Integration Guide

This guide explains how to integrate the DeviceClient into your FPVue VR app for backend communication.

## Integration Status

✅ **DeviceClient Integration Complete**

The DeviceClient has been successfully integrated into the FPVue VR app:

### Files Modified/Added:
- `app/src/main/cpp/deviceclient/DeviceClient.h` - Device client header
- `app/src/main/cpp/deviceclient/DeviceClient.cpp` - Device client implementation  
- `app/src/main/cpp/deviceclient/config.h` - Configuration file
- `app/src/main/cpp/CMakeLists.txt` - Updated build configuration
- `app/src/main/cpp/app.cpp` - Integrated device client into main app

## Configuration

### 1. Backend Server URL

Update the backend server URL in `app.cpp` line 171:

```cpp
device_client = new DeviceClient("http://YOUR_SERVER_IP:3000", "FPVue VR Device");
```

Replace `YOUR_SERVER_IP` with your actual server IP address.

### 2. Network Configuration

The device client is configured with these defaults:
- **Heartbeat Interval**: 10 seconds
- **HTTP Timeout**: 5 seconds  
- **Default WiFi Channel**: 173

## How It Works

### Device Registration
- On app startup, the device automatically registers with the backend
- Uses the device's MAC address as unique identifier
- Sends periodic heartbeat updates every 10 seconds

### WiFi Channel Management
- Device client checks for configuration changes every 10 seconds
- When WiFi channel changes in the backend, the callback `onWifiChannelChange()` is triggered
- The target channel is stored in `target_wifi_channel` atomic variable

### Backend Communication
- **Device Registration**: `POST /api/devices/register`
- **Configuration Check**: `GET /api/devices/{mac}/config`
- **Status Updates**: Automatic via registration endpoint

## Usage

### Starting the Backend
```bash
cd backend
./start-server.sh
```

### Building the App
```bash
cd app
./gradlew clean assembleDebug
```

### Viewing Device Information
The VR app now displays:
- Device MAC address (last 6 characters)
- Target WiFi channel from backend
- Connection status in statistics panel

## API Integration

### Device Registration
```json
POST /api/devices/register
{
  "mac_address": "aa:bb:cc:dd:ee:ff",
  "device_name": "FPVue VR Device"
}
```

### Get Configuration
```json
GET /api/devices/aa:bb:cc:dd:ee:ff/config
Response: {
  "wifi_channel": 173
}
```

### Update WiFi Channel
```json
PUT /api/devices/aa:bb:cc:dd:ee:ff/wifi-channel
{
  "wifi_channel": 149
}
```

## Troubleshooting

### Connection Issues
1. **Check IP Address**: Ensure the backend server IP is correct
2. **Network Connectivity**: Verify the VR device can reach the server
3. **Firewall**: Ensure port 3000 is open on the server
4. **Server Status**: Verify the backend server is running

### Debug Logging
Check Android logs for DeviceClient messages:
```bash
adb logcat | grep DeviceClient
```

### Common Log Messages
- `Device client initialized with MAC: xx:xx:xx:xx:xx:xx`
- `Device registered successfully`
- `WiFi channel change requested: 149`
- `Connection failed to 192.168.1.100:3000`

## Next Steps

### WFB-ng Integration
To fully integrate WiFi channel changes with WFB-ng:

1. **Modify WfbngLink**: Add support for runtime channel changes
2. **Restart WFB-ng**: Implement channel change by restarting with new channel
3. **Status Feedback**: Report channel change success/failure to backend

### Enhanced Features
- **Device Status**: Report battery level, signal strength
- **Error Reporting**: Send error logs to backend
- **Configuration Sync**: Sync more settings (bitrate, FEC levels)
- **Device Groups**: Support for grouped device management

## Testing

### Test Device Registration
1. Start backend server
2. Launch VR app
3. Check web interface - device should appear
4. Verify MAC address matches

### Test WiFi Channel Changes
1. Open web interface
2. Change WiFi channel for device
3. Check VR app statistics panel
4. Verify target channel updates

## Network Requirements

- **Backend Server**: Port 3000 TCP
- **VR Device**: Internet/network access
- **Firewall**: Allow outbound HTTP connections
- **WiFi**: Both server and device on same network (or routed)

The DeviceClient integration is complete and ready for testing!
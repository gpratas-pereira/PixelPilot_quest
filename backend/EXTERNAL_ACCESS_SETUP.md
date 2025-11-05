# External Network Access Setup Guide

## Current Status ✅
- Backend server is running on WSL IP: `172.27.89.39:3000`
- Server is accessible locally and bound to external interfaces
- FPVue app is configured to use: `http://192.168.1.100:3000`

## Required Steps for External Access

### 1. Run Windows PowerShell Script (Administrator Required)
```powershell
# Navigate to backend directory and run:
./setup-external-access.ps1
```

This script will:
- Set up port forwarding from Windows host to WSL
- Configure firewall rules
- Display Windows IP addresses for external access

### 2. Update FPVue App Configuration
After running the PowerShell script, update the IP address in the FPVue app:

**File:** `app/src/main/cpp/app.cpp` (line 171)
```cpp
// Change from:
device_client = new DeviceClient("http://192.168.1.100:3000", "FPVue VR Device");

// To (use Windows IP shown by PowerShell script):
device_client = new DeviceClient("http://[WINDOWS_IP]:3000", "FPVue VR Device");
```

### 3. Test External Connectivity
From an external device on the same network:
```bash
curl http://[WINDOWS_IP]:3000
curl http://[WINDOWS_IP]:3000/api/devices
```

### 4. Alternative Testing
Use the network testing tool to verify configuration:
```bash
node test-network-access.js
```

## Network Flow
```
External Device → Windows Host IP:3000 → WSL 172.27.89.39:3000 → Backend Server
```

## Troubleshooting
- Ensure Windows Defender allows port 3000
- Check router firewall settings
- Verify devices are on the same network
- Use Windows IP (not WSL IP) for external access
- Test with both HTTP and API endpoints

## Current WSL Configuration
- WSL IP: `172.27.89.39`
- Server Port: `3000`
- Server Status: ✅ Running and accessible
- Interface Binding: ✅ All interfaces (0.0.0.0)

## Next Steps
1. Run the PowerShell script as Administrator
2. Note the Windows IP address shown
3. Update the FPVue app IP configuration
4. Rebuild and test the app
5. Test external device connectivity
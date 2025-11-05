# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PixelPilot is an Android FPV (First Person View) application designed for low-latency video streaming from drone cameras to Android devices, including Meta Quest VR headsets. It integrates multiple components for wireless broadcast, video decoding, MAVLink telemetry, and VR display.

The project consists of two main components:
- **Android Application**: FPV streaming app with VR support
- **Node.js Backend**: Device management server for rewards system and device tracking

## Build System

### Standard Android Build
```bash
# Clean and build debug APK
./gradlew clean assembleDebug

# Build with specific ABI (optimized for Quest 3)
./gradlew assembleDebug -Pandroid.injected.build.abi=arm64-v8a

# Build release APK
./gradlew assembleRelease
```

### VR Build (Quest 3 Support)
```bash
# Enable VR features during build
./gradlew assembleDebug -PenableVr=true

# Skip Spatial SDK export for faster debug builds
./gradlew assembleDebug -PenableVr=true -PspatialSkipExport=true

# Use convenience scripts
./build_quest.sh           # Full Quest 3 build and install
./scripts/build_vr_debug.sh # VR debug build only
```

### Setup Scripts
```bash
# Windows PowerShell
./scripts/setup_vr.ps1     # Download Meta Spatial SDK and build VR
./run_xr.ps1               # Quick build and install for Quest

# Linux/WSL
./scripts/install_and_launch_vr.sh  # Install and launch VR activity
```

### Backend Development
```bash
# Navigate to backend directory
cd backend/

# Install dependencies
npm install

# Start development server with auto-reload
npm run dev

# Start production server
npm start
```

## Architecture

### Module Structure
- **app/**: Main application module
  - **mavlink/**: MAVLink telemetry handling (C++ native)
  - **videonative/**: H.264/H.265 video decoding (C++ with Android MediaCodec)
  - **wfbngrtl8812/**: WFB-NG wireless broadcast integration with RTL8812AU drivers
  - **xr/**: OpenXR components for Quest VR support
- **backend/**: Node.js server for device management
  - **routes/**: API routes for rewards and admin functionality
  - **public/**: Web interface files (HTML/JS/CSS)
  - **database/**: SQLite database and migration scripts
  - **utils/**: Helper utilities for rewards integration

### Key Android Activities
- **VideoActivity**: Primary 2D FPV interface with OSD overlays
- **VRSpatialActivity**: VR immersive mode for Meta Quest devices
- **WfbNgVpnService**: VPN service for network traffic routing

### Core Components
- **WfbLinkManager**: Manages USB WiFi adapter connections and WFB-NG link
- **VideoPlayer**: Native video decoder with low-latency optimizations
- **OSDManager**: On-screen display for telemetry data
- **CurvedScreenGLView**: OpenGL-based curved display for VR

### Backend Components
- **server.js**: Main Express.js server with device management APIs
- **rewards-integration.js**: Points system and blockchain verification
- **SQLite Database**: Device tracking, pilot management, rewards system

## Development Environment

### Requirements
- Android Studio with NDK 26.1.10909125
- OpenJDK 17 (custom JDK path can be set in gradle.properties)
- Android SDK with platform-tools (adb)
- Meta Quest Developer Mode enabled for VR testing
- Node.js and npm for backend development

### VR Development
- Set `enableVr=true` in gradle.properties or use `-PenableVr=true`
- Meta Spatial SDK is downloaded automatically from Maven Central
- VR features require `com.oculus.intent.category.VR` intent category

### USB Hardware Support
- Supported RTL8812AU WiFi adapters are defined in `app/src/main/res/xml/usb_device_filter.xml`
- Add new hardware IDs to this file for additional adapter support

## Common Tasks

### Testing on Quest
```bash
# Connect via ADB over WiFi
adb connect [QUEST_IP]:5555

# Install and launch VR mode
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.openipc.pixelpilot/.VRSpatialActivity

# Launch regular 2D mode
adb shell am start -n com.openipc.pixelpilot/.VideoActivity
```

### Backend Management
```bash
# Run database migrations
cd backend/
node apply_migration.js

# Test network access
node test-network-access.js

# Check rewards system
node check_assignments.js
```

### Build Configuration
- Enable/disable VR: `enableVr=true/false` in gradle.properties
- Meta SDK version: `metaSpatialSdkVersion=0.7.2`
- Skip Spatial export: `-PspatialSkipExport=true` (for faster debug builds)

### Submodules
```bash
# Initialize WFB-NG and other submodules
git submodule init
git submodule update
```

## Key Implementation Details

### Video Pipeline
- UDP/UDS packet reception in C++
- H.264/H.265 decoding via Android MediaCodec
- Low-latency surface rendering with configurable output formats
- DVR recording to `/Movies/` directory

### WFB-NG Integration
- Custom RTL8812AU userspace driver
- Adaptive FEC (Forward Error Correction) levels 0-5
- Real-time signal quality monitoring
- Custom frequency and bandwidth configuration (20/40 MHz)

### VR Implementation
- Dual-eye stereoscopic rendering
- OpenXR integration for Quest platform
- Hand tracking and controller input support
- Curved screen projection for immersive viewing

### MAVLink Telemetry
- Real-time flight data processing
- OSD element positioning and display
- GPS coordinates, altitude, speed, battery status
- Custom telemetry parsing and visualization

### Backend Services
- Express.js REST API for device management
- SQLite database with migration system
- Rewards and points system with blockchain verification
- Web interface for admin and pilot management

## Build Troubleshooting

### Android Issues
- **JDK Issues**: Ensure OpenJDK 17 is available, custom path in gradle.properties
- **NDK Version**: Must use NDK 26.1.10909125 for compatibility
- **VR Build Failures**: Try `-PspatialSkipExport=true` or ensure Meta SDK download succeeded
- **Quest Connection**: Enable Developer Mode and USB debugging, use `adb connect` for wireless deployment
- **Submodule Issues**: Run `git submodule init && git submodule update` if WFB-NG components are missing

### Backend Issues
- **Port Conflicts**: Default server runs on port 3000, check if available
- **Database Lock**: Stop server before running migration scripts
- **Node Modules**: Delete `node_modules/` and run `npm install` if dependencies are corrupted

## Working Directory Structure

The codebase is organized as follows:
- Root directory contains Android project files (gradle, settings)
- `app/` contains the main Android application with native modules
- `backend/` contains Node.js server (independent working directory)
- `external/` contains OpenXR and Meta SDK dependencies
- `scripts/` contains build and setup automation scripts
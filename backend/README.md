# FPVue Device Manager Backend

A web-based management system for FPVue VR devices that allows you to:
- Identify devices by MAC address
- Manage WiFi channels remotely
- Monitor device status and connectivity
- Configure device settings through a web interface

## Features

- 📱 **Device Registration**: Automatic device identification using MAC addresses
- 📡 **WiFi Channel Management**: Change WiFi channels remotely via web interface
- 🔍 **Device Monitoring**: Real-time status tracking and last seen timestamps
- 🌐 **Web Interface**: Modern, responsive web UI for device management
- 📊 **Device Information**: View device details, status, and configuration
- 🔒 **RESTful API**: Complete API for device management and configuration
- 🎟️ **Pilot Ticketing**: Supabase-authenticated ticket purchases with USD-T payment tracking
- 🛠️ **Pit Lane Control**: Admin console to approve payments and bind headsets during race day operations
- ⏱️ **Minute Packages**: Predefined racing bundles that pilots select online and are auto-assigned to headset sessions
- 🔗 **On-Chain Verification**: Optional BNB Smart Chain watcher that auto-confirms USDT payments

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Start the Server

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000`

### 3. Access Web Interface

Open your browser and navigate to `http://localhost:3000`

#### WSL Access from Windows

If running on WSL, you need to set up port forwarding to access from Windows:

**Option 1: Automatic Setup (Recommended)**
1. Copy `setup-wsl-access.ps1` to your Windows desktop
2. Right-click and "Run with PowerShell" as Administrator
3. Access at `http://localhost:3000` from Windows

**Option 2: Manual Setup**
1. Run `./setup-wsl-access.sh` in WSL to get commands
2. Run the provided PowerShell commands as Administrator
3. Access at `http://localhost:3000` from Windows

**Option 3: Direct IP Access**
- Find WSL IP: `hostname -I` 
- Access at `http://[WSL_IP]:3000` from Windows

## Supabase Authentication & Ticketing

The backend now exposes Supabase-protected endpoints for pilot registration, ticket purchases, and pit lane headset mapping.  
Add the following environment variables before starting the server:

- `SUPABASE_URL` – your Supabase project URL.
- `SUPABASE_ANON_KEY` – public anon key used by the web client.
- `SUPABASE_SERVICE_ROLE_KEY` – service key used on the server to validate sessions.
- `ADMIN_EMAILS` – optional comma-separated list of crew emails allowed to access the admin console.

You can place them in a `.env` file inside the `backend` directory or export them in your shell before running `npm start`.

### USD-T Ticketing Flow
1. Pilots sign in on `tickets.html` using Supabase email authentication.
2. They choose one of the predefined minute packages, provide their preferred display name and optional wallet address.
3. After sending the USD-T transfer, they submit the transaction hash (and optional amount).
4. The backend verifier fetches the transaction on BNB Smart Chain, checks the USDT transfer into your wallet, and automatically marks the ticket as paid when the transaction reaches the configured confirmations; the selected package duration is automatically attached to the pilot’s session.

Whenever a pilot is mapped to a headset, any lap telemetry captured during that session is automatically linked back to their profile.

### Pit Lane Control Console

- Browse to `http://localhost:3000/admin.html` for the crew-facing control center.
- Sign in with a Supabase user whose email appears in `ADMIN_EMAILS`, or whose Supabase metadata/app metadata marks them as an admin.
- Review ticket payments, mark them as **Paid**, **Pending**, **Canceled**, or **Refunded**, update the published USD-T wallet address, and immediately assign verified pilots to available headsets.
- Each assignment automatically creates a lap session, links the chosen minute package, and pushes the pilot/package/time remaining to the VR HUD and backend dashboards.
- Use the **Complete** action to close an active pit-lane registration when a stint ends; the next assignment automatically releases the headset.

## API Endpoints

### Device Management

- `GET /api/devices` - List all devices
- `POST /api/devices/register` - Register/update a device
- `GET /api/devices/:mac_address/config` - Get device configuration
- `PUT /api/devices/:mac_address/wifi-channel` - Update WiFi channel
- `PUT /api/devices/:mac_address/name` - Update device name
- `DELETE /api/devices/:mac_address` - Delete device

### Example API Usage

#### Register a Device
```bash
curl -X POST http://localhost:3000/api/devices/register \
  -H "Content-Type: application/json" \
  -d '{
    "mac_address": "aa:bb:cc:dd:ee:ff",
    "device_name": "My FPVue Device"
  }'
```

#### Update WiFi Channel
```bash
curl -X PUT http://localhost:3000/api/devices/aa:bb:cc:dd:ee:ff/wifi-channel \
  -H "Content-Type: application/json" \
  -d '{"wifi_channel": 149}'
```

#### Get Device Configuration
```bash
curl http://localhost:3000/api/devices/aa:bb:cc:dd:ee:ff/config
```

### Pilot & Ticketing

- `GET /api/public-config` – Shares public Supabase and payment configuration (wallet + minute packages) with the frontend.
-   - Returns `minutePackages` (the predefined bundles stored in `MINUTE_PACKAGES` inside `server.js`).
- `GET /api/pilots/me` – Returns the authenticated pilot profile, tickets, and pit lane registrations.
- `POST /api/pilots/profile` – Updates the pilot's display name and wallet address.
- `GET /api/tickets/me` – Lists tickets purchased by the authenticated pilot.
- `POST /api/tickets/purchase` – Records a ticket purchase with USD-T payment metadata.
- `POST /api/pit-lane/register` – Assigns a pilot and ticket to a headset for race tracking.
- `GET /api/pit-lane/registrations` – Admin-only list of pit lane registrations with pilot and ticket details.
- `GET /api/admin/tickets` – Admin listing of all tickets, payment metadata, and linked pilots.
- `PUT /api/admin/tickets/:ticketId/status` – Update ticket payment status (pending, paid, canceled, refunded).
- `GET /api/admin/pilots` – Searchable roster of pilots with paid/pending ticket counts.
- `PUT /api/admin/pit-lane/registrations/:registrationId` – Update a pit lane registration (complete, cancel, release).
- `GET /api/admin/payment-settings` – Admin read of the USD-T wallet shown to pilots.
- `PUT /api/admin/payment-settings` – Admin update of the USD-T wallet (auto-updates ticket and pit-lane UIs).

### Minute Packages

Edit the `MINUTE_PACKAGES` constant in `backend/server.js` to adjust the available bundles (label + number of minutes). These bundles are shown during ticket purchase, surfaced on the admin console, and automatically drive headset session timers and VR HUD labels.

## Integration with FPVue App

### Android App Integration

1. Add the device client code to your FPVue app
2. Include required dependencies in your `build.gradle`:

```gradle
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.10.0'
    implementation 'com.google.code.gson:gson:2.10.1'
}
```

3. Initialize the device client in your app:

```cpp
// In app_init()
device_client = new DeviceClient("http://your-server:3000", "FPVue Device");
device_client->start();

// In app_exit()
if (device_client) {
    device_client->stop();
    delete device_client;
}
```

### Configuration

The device client will automatically:
- Register the device with the backend using MAC address
- Send periodic heartbeats to maintain online status
- Check for configuration changes (WiFi channel updates)
- Apply configuration changes to the WFB-ng system

## Web Interface Features

### Device List
- View all registered devices
- See online/offline status
- Filter devices by MAC address or name
- Real-time updates every 30 seconds

### Device Management
- Edit device names
- Change WiFi channels (1-200)
- Quick channel change buttons
- Delete devices

### Add New Devices
- Register devices manually
- Automatic MAC address validation
- Custom device naming

## Database Schema

The system uses SQLite with the following schema:

```sql
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    mac_address TEXT UNIQUE NOT NULL,
    device_name TEXT,
    wifi_channel INTEGER DEFAULT 173,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'offline',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
- `DB_PATH` - Database file path (default: ./devices.db)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` - Supabase credentials for authentication and admin verification.
- `ADMIN_EMAILS` - Optional comma-separated list of admin emails allowed to access the control console.
- `PAYMENT_USDT_ADDRESS` - Optional default USD-T wallet address (can be updated from the admin console at runtime).
- `BSC_RPC_URL` - BNB Smart Chain RPC endpoint used for on-chain payment verification.
- `BSC_USDT_CONTRACT` - USDT contract address on BNB Smart Chain.
- `BSC_MIN_CONFIRMATIONS` - (Optional) Confirmations required before a payment is considered final (default: 12).
- `BSC_USDT_DECIMALS` - (Optional) Token decimals for USDT on BSC (default: 18).
- `BSC_POLL_INTERVAL_MS` - (Optional) Polling interval for the verifier worker in milliseconds (default: 60000).

### WiFi Channels

The system supports WiFi channels 1-200. Common 5GHz channels for FPV:
- 36, 40, 44, 48 (Lower 5GHz)
- 149, 153, 157, 161, 165 (Upper 5GHz)
- 173, 177, 181 (Extended range)

## Security Considerations

- Run the server on a secure network
- Consider adding authentication for production use
- Use HTTPS in production environments
- Implement rate limiting for API endpoints

## Development

### File Structure
```
backend/
├── server.js          # Main server file
├── package.json       # Dependencies
├── devices.db         # SQLite database (auto-created)
├── public/
│   ├── index.html     # Web interface
│   ├── styles.css     # Styling
│   ├── app.js         # Device dashboard logic
│   ├── tickets.html   # Pilot ticket storefront
│   ├── tickets.js     # Ticket purchase logic
│   ├── admin.html     # Pit lane control console
│   └── admin.js       # Admin workflow logic
├── device-client.cpp  # C++ client for FPVue app
└── README.md         # This file
```

### Adding Features

1. **Authentication**: Add user authentication and session management
2. **Groups**: Organize devices into groups for batch operations
3. **Telemetry**: Add more telemetry data (signal strength, battery, etc.)
4. **Alerts**: Add notification system for device status changes
5. **History**: Track configuration change history
6. **Backup**: Device configuration backup and restore

## Troubleshooting

### Common Issues

1. **Device not registering**: Check network connectivity and server URL
2. **WiFi channel not changing**: Verify WFB-ng integration and permissions
3. **Web interface not loading**: Check server is running and port is accessible
4. **Database errors**: Ensure write permissions in the backend directory

### Logs

Server logs are output to console. Enable debug logging:

```bash
DEBUG=* npm start
```

## License

MIT License - See LICENSE file for details

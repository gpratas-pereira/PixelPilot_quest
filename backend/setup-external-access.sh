#!/bin/bash

# Linux script to help set up external network access
# Run this from within WSL

echo "🌐 FPVue Device Manager - External Network Access Setup"
echo "======================================================="

# Get network information
WSL_IP=$(hostname -I | awk '{print $1}')
echo "📍 WSL IP Address: $WSL_IP"

# Get default gateway (router IP)
GATEWAY=$(ip route show default | awk '/default/ { print $3 }')
echo "🏠 Default Gateway: $GATEWAY"

# Check if server is running
if netstat -tuln | grep -q ":3000"; then
    echo "✅ Server is running on port 3000"
else
    echo "❌ Server is not running. Start it with: npm start"
fi

# Test local connectivity
echo ""
echo "🔍 Testing local connectivity..."
if curl -s --connect-timeout 3 http://localhost:3000 > /dev/null; then
    echo "✅ Local server accessible"
else
    echo "❌ Local server not accessible"
fi

echo ""
echo "📋 Windows PowerShell Commands (run as Administrator):"
echo "======================================================"
echo ""
echo "1. Set up external port forwarding:"
echo "   netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$WSL_IP"
echo ""
echo "2. Add firewall rules for external access:"
echo "   New-NetFirewallRule -DisplayName 'FPVue Device Manager' -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any"
echo ""
echo "3. View current port forwarding:"
echo "   netsh interface portproxy show v4tov4"
echo ""
echo "4. Get Windows IP addresses:"
echo "   Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -ne '127.0.0.1' }"
echo ""

echo "🌐 Network Configuration:"
echo "========================"
echo "- WSL Server: http://$WSL_IP:3000"
echo "- Windows Host: http://localhost:3000 (after port forwarding)"
echo "- External Access: http://[WINDOWS_IP]:3000 (after setup)"
echo ""

echo "🔧 Router Configuration (if needed):"
echo "===================================="
echo "If devices still can't connect, check:"
echo "1. Router firewall blocking port 3000"
echo "2. Windows Defender firewall"
echo "3. Network isolation (guest network)"
echo "4. VPN interfering with local network"
echo ""

echo "🧪 Testing Commands:"
echo "==================="
echo "Test from external device:"
echo "  curl http://[WINDOWS_IP]:3000"
echo "  curl http://[WINDOWS_IP]:3000/api/devices"
echo ""

echo "💡 Alternative: Use the PowerShell script setup-external-access.ps1"
echo "   for automatic configuration"
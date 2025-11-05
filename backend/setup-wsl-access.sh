#!/bin/bash

# Linux script to help set up WSL access
# Run this from within WSL

echo "🔧 FPVue Device Manager - WSL Access Setup"
echo "========================================="

# Get WSL IP address
WSL_IP=$(hostname -I | awk '{print $1}')
echo "📍 WSL IP Address: $WSL_IP"

# Check if server is running
if netstat -tuln | grep -q ":3000"; then
    echo "✅ Server is running on port 3000"
else
    echo "❌ Server is not running. Start it with: npm start"
fi

echo ""
echo "📋 Windows PowerShell Commands (run as Administrator):"
echo "======================================================"
echo ""
echo "1. Set up port forwarding:"
echo "   netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=$WSL_IP"
echo ""
echo "2. Add firewall rule:"
echo "   New-NetFirewallRule -DisplayName \"FPVue Device Manager\" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow"
echo ""
echo "3. View current port forwarding:"
echo "   netsh interface portproxy show v4tov4"
echo ""
echo "4. Remove port forwarding (when done):"
echo "   netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=0.0.0.0"
echo ""
echo "🌐 Access URLs after setup:"
echo "=========================="
echo "- From Windows: http://localhost:3000"
echo "- From WSL: http://localhost:3000"
echo "- From network: http://[YOUR_WINDOWS_IP]:3000"
echo ""
echo "💡 Alternative: Use the PowerShell script setup-wsl-access.ps1"
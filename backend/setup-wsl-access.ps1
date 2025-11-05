# PowerShell script to set up WSL port forwarding
# Run this in Windows PowerShell as Administrator

Write-Host "Setting up WSL port forwarding for FPVue Device Manager..." -ForegroundColor Green

# Get WSL IP address
$wslIp = wsl hostname -I
$wslIp = $wslIp.Trim()
Write-Host "WSL IP Address: $wslIp" -ForegroundColor Yellow

# Port to forward
$port = 3000

# Remove existing port forwarding (if any)
Write-Host "Removing existing port forwarding..." -ForegroundColor Yellow
try {
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0
} catch {
    Write-Host "No existing port forwarding found" -ForegroundColor Gray
}

# Add new port forwarding
Write-Host "Adding port forwarding from Windows to WSL..." -ForegroundColor Yellow
netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=$wslIp

# Add firewall rule
Write-Host "Adding Windows Firewall rule..." -ForegroundColor Yellow
try {
    New-NetFirewallRule -DisplayName "FPVue Device Manager" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow
} catch {
    Write-Host "Firewall rule may already exist" -ForegroundColor Gray
}

# Show current port proxy settings
Write-Host "`nCurrent port forwarding settings:" -ForegroundColor Green
netsh interface portproxy show v4tov4

Write-Host "`n✅ Setup complete!" -ForegroundColor Green
Write-Host "You can now access the FPVue Device Manager at:" -ForegroundColor Cyan
Write-Host "- Local: http://localhost:$port" -ForegroundColor White
Write-Host "- Network: http://$($(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi' -ErrorAction SilentlyContinue).IPAddress):$port" -ForegroundColor White
Write-Host "- Network: http://$($(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Ethernet' -ErrorAction SilentlyContinue).IPAddress):$port" -ForegroundColor White

Write-Host "`nTo remove port forwarding later, run:" -ForegroundColor Yellow
Write-Host "netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0" -ForegroundColor Gray
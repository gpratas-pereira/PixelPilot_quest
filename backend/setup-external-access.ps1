# PowerShell script to set up external network access for FPVue Device Manager
# Run this in Windows PowerShell as Administrator

Write-Host "Setting up external network access for FPVue Device Manager..." -ForegroundColor Green

# Get WSL IP address
$wslIp = wsl hostname -I
$wslIp = $wslIp.Trim()
Write-Host "WSL IP Address: $wslIp" -ForegroundColor Yellow

# Get Windows IP addresses
$windowsIPs = @()
$adapters = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -eq "Dhcp" }
foreach ($adapter in $adapters) {
    $windowsIPs += $adapter.IPAddress
}

Write-Host "Windows IP Addresses:" -ForegroundColor Yellow
$windowsIPs | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }

# Port to forward
$port = 3000

# Remove existing port forwarding rules
Write-Host "Removing existing port forwarding rules..." -ForegroundColor Yellow
try {
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=127.0.0.1
} catch {
    Write-Host "No existing rules found" -ForegroundColor Gray
}

# Add port forwarding from all interfaces to WSL
Write-Host "Adding port forwarding to WSL..." -ForegroundColor Yellow
netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=$wslIp

# Remove existing firewall rules
Write-Host "Removing existing firewall rules..." -ForegroundColor Yellow
try {
    Remove-NetFirewallRule -DisplayName "FPVue Device Manager" -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "FPVue External Access" -ErrorAction SilentlyContinue
} catch {
    Write-Host "No existing firewall rules found" -ForegroundColor Gray
}

# Add comprehensive firewall rules
Write-Host "Adding firewall rules for external access..." -ForegroundColor Yellow
New-NetFirewallRule -DisplayName "FPVue Device Manager" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "FPVue External Access" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Public

# Show current configuration
Write-Host "`nCurrent port forwarding configuration:" -ForegroundColor Green
netsh interface portproxy show v4tov4

Write-Host "`nFirewall rules:" -ForegroundColor Green
Get-NetFirewallRule -DisplayName "*FPVue*" | Format-Table DisplayName, Direction, Action, Enabled

Write-Host "`n✅ External access setup complete!" -ForegroundColor Green
Write-Host "`nAccess URLs:" -ForegroundColor Cyan
Write-Host "- Local (WSL): http://localhost:$port" -ForegroundColor White
Write-Host "- Local (Windows): http://localhost:$port" -ForegroundColor White

foreach ($ip in $windowsIPs) {
    Write-Host "- External: http://${ip}:$port" -ForegroundColor Yellow
}

Write-Host "`n📱 For FPVue devices, use one of these IPs in app.cpp:" -ForegroundColor Cyan
foreach ($ip in $windowsIPs) {
    Write-Host "  http://${ip}:$port" -ForegroundColor White
}

Write-Host "`n🔧 Next steps:" -ForegroundColor Yellow
Write-Host "1. Update the IP address in your FPVue app code" -ForegroundColor White
Write-Host "2. Test connectivity from external devices" -ForegroundColor White
Write-Host "3. Check router firewall if devices can't connect" -ForegroundColor White

Write-Host "`n🗑️ To remove later:" -ForegroundColor Yellow
Write-Host "netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0" -ForegroundColor Gray
Write-Host "Remove-NetFirewallRule -DisplayName 'FPVue*'" -ForegroundColor Gray
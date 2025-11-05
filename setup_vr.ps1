Param(
  [string]$DeviceIp = "192.168.68.63:5555",
  [switch]$SkipExport
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[+] $msg" -ForegroundColor Cyan }
function Write-Info($msg) { Write-Host "    $msg" -ForegroundColor DarkGray }

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot
Write-Step "Repo root: $RepoRoot"

# Ensure ADB is available
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw "adb not found on PATH. Install Android platform-tools or add it to PATH."
}

# Ensure Gradle wrapper exists
if (-not (Test-Path .\gradlew.bat)) {
  throw "gradlew.bat not found. Run from the repository root."
}

# Ensure libs directory
$libs = Join-Path $RepoRoot "app\libs"
if (-not (Test-Path $libs)) { New-Item -ItemType Directory -Path $libs | Out-Null }

# Pick Spatial SDK version
$spatialVer = "0.7.2"
$aarName = "meta-spatial-sdk-$spatialVer.aar"
$aarPath = Join-Path $libs $aarName

# Download Spatial SDK AAR from Maven Central if missing
if (-not (Test-Path $aarPath)) {
  Write-Step "Downloading Meta Spatial SDK AAR $spatialVer from Maven Central"
  $url = "https://repo1.maven.org/maven2/com/meta/spatial/meta-spatial-sdk/$spatialVer/meta-spatial-sdk-$spatialVer.aar"
  Write-Info $url
  Invoke-WebRequest -Uri $url -OutFile $aarPath
} else {
  Write-Step "Using existing AAR: $aarPath"
}

# Build VR with optional export skip
$props = @("-P","enableVr=true")
if ($SkipExport) { $props += @("-P","spatialSkipExport=true") }

Write-Step "Cleaning project"
& .\gradlew.bat --no-daemon clean | Write-Output

Write-Step "Building debug APK (VR enabled)"
& .\gradlew.bat --no-daemon @props assembleDebug | Write-Output

$apk = "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }

# Connect to device and install
Write-Step "Connecting ADB to $DeviceIp"
& adb connect $DeviceIp | Write-Output

Write-Step "Installing APK on device"
& adb -s $DeviceIp install -r $apk | Write-Output

Write-Step "Launching VRSpatialActivity"
& adb -s $DeviceIp shell am start -n com.openipc.pixelpilot/.VRSpatialActivity | Write-Output

Write-Step "Done."


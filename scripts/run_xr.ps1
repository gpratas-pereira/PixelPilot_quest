Param(
  [string]$DeviceIp = "192.168.1.96:5555",
  [int]$LogSeconds = 10
)

$ErrorActionPreference = "Stop"

function Step($m){ Write-Host "[+] $m" -ForegroundColor Cyan }
function Info($m){ Write-Host "    $m" -ForegroundColor DarkGray }

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw "adb not found on PATH. Install Android Platform-Tools."
}
if (-not (Test-Path .\gradlew.bat)) { throw "Run from repo root (gradlew.bat not found)." }

Step "Building XR module (arm64)"
& .\gradlew.bat --no-daemon :app:xr:assembleDebug | Write-Output

Step "Building app debug APK"
& .\gradlew.bat --no-daemon assembleDebug | Write-Output

$apk = "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "APK not found at $apk" }

Step "Connecting ADB to $DeviceIp"
& adb connect $DeviceIp | Write-Output

Step "Installing APK"
& adb -s $DeviceIp install -r $apk | Write-Output

Step "Clearing logcat"
& adb -s $DeviceIp shell logcat -c | Out-Null

Step "Launching OpenXR NativeActivity"
& adb -s $DeviceIp shell am start -n com.openipc.pixelpilot/android.app.NativeActivity | Write-Output

Step "Capturing logs ($LogSeconds s)"
if (-not (Test-Path logs)) { New-Item -ItemType Directory -Path logs | Out-Null }
$logFile = Join-Path $RepoRoot ("logs\\openxr_run_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".txt")
Start-Job -Name XRLog -ScriptBlock {
  Param($dev, $out)
  $p = Start-Process adb -ArgumentList @('-s', $dev, 'shell', 'logcat', '-v', 'time') -NoNewWindow -PassThru -RedirectStandardOutput $out
  Start-Sleep -Seconds $using:LogSeconds
  try { $p | Stop-Process -Force } catch {}
} -ArgumentList $DeviceIp, $logFile | Out-Null
Wait-Job XRLog | Out-Null
Receive-Job XRLog | Out-Null

Step "Key log lines"
Get-Content $logFile | Select-String -Pattern "openxr_app|OpenXR|xrCreateInstance|xrGetSystem|xrCreateSession|xrBeginSession|xrEndSession|EGL|GLES|XR_ERROR" | Select-Object -Last 60

Step "Full log saved to $logFile"


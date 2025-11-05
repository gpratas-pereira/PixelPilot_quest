Param(
  [string]$Version = "release-1.0.34"
)

$ErrorActionPreference = "Stop"

function Write-Step($m){ Write-Host "[+] $m" -ForegroundColor Cyan }
function Write-Info($m){ Write-Host "    $m" -ForegroundColor DarkGray }

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$targetRoot = Join-Path $repoRoot "external\OpenXR-Headers"
if (-not (Test-Path $targetRoot)) { New-Item -ItemType Directory -Path $targetRoot | Out-Null }

# Try a tagged release first, then fall back to main
$urls = @(
  "https://github.com/KhronosGroup/OpenXR-Headers/archive/refs/tags/$Version.zip",
  "https://github.com/KhronosGroup/OpenXR-Headers/archive/refs/heads/main.zip"
)

$tmp = New-Item -ItemType Directory -Path ([System.IO.Path]::Combine([System.IO.Path]::GetTempPath(),"openxr_headers_" + [System.Guid]::NewGuid()))
$zipPath = Join-Path $tmp.FullName "headers.zip"

$downloaded = $false
foreach($u in $urls){
  try {
    Write-Step "Downloading OpenXR headers: $u"
    Invoke-WebRequest -Uri $u -OutFile $zipPath -UseBasicParsing
    $downloaded = $true
    break
  } catch {
    Write-Info "Failed: $($_.Exception.Message)"
  }
}

if (-not $downloaded) { throw "Unable to download OpenXR headers (release $Version or main)." }

Write-Step "Extracting headers"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tmp.FullName)

# Locate extracted root (single subdirectory)
$root = Get-ChildItem $tmp.FullName | Where-Object { $_.PsIsContainer } | Select-Object -First 1
if (-not $root) { throw "Extraction failed: cannot locate extracted root" }

$includeSrc = Join-Path $root.FullName "include"
if (-not (Test-Path (Join-Path $includeSrc "openxr\openxr.h"))) {
  throw "openxr.h not found in extracted archive."
}

$includeDst = Join-Path $targetRoot "include"
if (Test-Path $includeDst) { Remove-Item -Recurse -Force $includeDst }
Write-Step "Copying include -> $includeDst"
Copy-Item -Recurse -Force $includeSrc $includeDst

Write-Step "Done. Headers available at $includeDst"


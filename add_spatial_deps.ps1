Param(
  [string]$Version = "0.7.2",
  [string]$BuildGradle = "app\build.gradle",
  [switch]$Write
)

$ErrorActionPreference = "Stop"

function Write-Step($m){ Write-Host "[+] $m" -ForegroundColor Cyan }
function Write-Info($m){ Write-Host "    $m" -ForegroundColor DarkGray }

Write-Step "Querying Maven Central for com.meta.spatial:$Version"
$url = "https://search.maven.org/solrsearch/select?q=g:%22com.meta.spatial%22+AND+v:%22$Version%22&rows=200&wt=json"
$resp = Invoke-WebRequest -Uri $url -UseBasicParsing
$json = $resp.Content | ConvertFrom-Json
$arts = $json.response.docs | ForEach-Object { $_.a } | Sort-Object -Unique
if (-not $arts) { throw "No com.meta.spatial artifacts found for $Version" }

Write-Step "Found artifacts:"; $arts | ForEach-Object { Write-Info $_ }

# Choose likely API modules used by imports (filter out plugin/gradle artifacts)
$include = $arts | Where-Object { $_ -notmatch 'plugin|gradle|kotlin' }

Write-Step "Dependency snippet for build.gradle (VR enabled block):"
$snippet = @()
$snippet += "if (enableVr) {"
foreach($a in $include){
  $snippet += "    implementation \"com.meta.spatial:$a:$Version\""
}
$snippet += "}"
$snippetText = $snippet -join "`n"
Write-Host $snippetText -ForegroundColor Yellow

if ($Write) {
  Write-Step "Injecting dependencies into $BuildGradle"
  $gradleText = Get-Content $BuildGradle -Raw
  if ($gradleText -notmatch 'dependencies\s*\{') { throw "dependencies { } block not found in $BuildGradle" }
  # Insert just before the closing brace of dependencies
  $updated = $gradleText -replace '(?s)(dependencies\s*\{)(.*?)(\n\})', "$1`$2`n$snippetText`n}"
  Set-Content -Path $BuildGradle -Value $updated -Encoding UTF8
  Write-Step "Updated $BuildGradle"
}


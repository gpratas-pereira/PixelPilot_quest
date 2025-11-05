$ErrorActionPreference = "Stop"

# Path to the database and migration file
$dbPath = ".\devices.db"
$migrationPath = ".\database\migrations\002_add_pilot_display_name.sql"

# Read the migration SQL
$migrationSql = Get-Content -Path $migrationPath -Raw

# Execute the migration using sqlite3
try {
    Write-Host "🔧 Applying migration to $dbPath..."
    
    # Execute each statement one by one
    $migrationSql -split "(;\s*\r?\n|;\s*$)" | Where-Object { $_.Trim() -ne "" } | ForEach-Object {
        $statement = $_.Trim()
        if ($statement) {
            Write-Host "  Executing: $($statement.Substring(0, [Math]::Min(50, $statement.Length)))..."
            sqlite3 $dbPath $statement
        }
    }
    
    Write-Host "✅ Migration applied successfully!"
} catch {
    Write-Host "❌ Error applying migration: $_" -ForegroundColor Red
    exit 1
}

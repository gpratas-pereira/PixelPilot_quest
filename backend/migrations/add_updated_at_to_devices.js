const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'devices.db');
const db = new sqlite3.Database(dbPath);

console.log('🔍 Checking devices table for updated_at column...');

// First, check if the column exists
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'", [], (err, row) => {
    if (err) {
        console.error('❌ Error checking devices table:', err.message);
        process.exit(1);
    }

    if (!row) {
        console.error('❌ devices table does not exist');
        process.exit(1);
    }

    // Check if updated_at column exists
    db.all("PRAGMA table_info(devices)", [], (err, columns) => {
        if (err) {
            console.error('❌ Error checking table columns:', err.message);
            process.exit(1);
        }

        const hasUpdatedAt = columns.some(col => col.name === 'updated_at');
        
        if (hasUpdatedAt) {
            console.log('✅ updated_at column already exists in devices table');
            process.exit(0);
        }

        // Add the updated_at column without a default value first
        console.log('🔄 Adding updated_at column to devices table...');
        db.run("ALTER TABLE devices ADD COLUMN updated_at TIMESTAMP", (err) => {
            if (err) {
                console.error('❌ Error adding updated_at column:', err.message);
                process.exit(1);
            }
            
            console.log('✅ Successfully added updated_at column to devices table');
            
            // Set updated_at to current timestamp for all existing rows
            console.log('🔄 Setting updated_at for existing records...');
            db.run("UPDATE devices SET updated_at = CURRENT_TIMESTAMP", (err) => {
                if (err) {
                    console.error('❌ Error setting updated_at for existing records:', err.message);
                    process.exit(1);
                }
                
                // Now add the default value constraint
                console.log('🔄 Adding default value constraint to updated_at...');
                // SQLite doesn't support ALTER COLUMN to add a default, so we need to recreate the table
                db.serialize(() => {
                    // Create a temporary table with the same structure
                    db.run(`
                        CREATE TABLE devices_temp (
                            id TEXT PRIMARY KEY,
                            device_id TEXT UNIQUE,
                            mac_address TEXT,
                            device_name TEXT,
                            wifi_channel INTEGER DEFAULT 173,
                            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                            status TEXT DEFAULT 'offline',
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            session_duration INTEGER DEFAULT 1800,
                            session_start_time DATETIME,
                            session_remaining INTEGER DEFAULT 1800,
                            battery_level INTEGER DEFAULT -1,
                            battery_charging BOOLEAN DEFAULT 0,
                            display_mode TEXT DEFAULT 'curved',
                            current_pilot_id TEXT,
                            current_pilot_name TEXT,
                            current_ticket_id TEXT,
                            current_session_id TEXT,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    
                    // Copy data from old table to new table
                    db.run(`
                        INSERT INTO devices_temp (
                            id, device_id, mac_address, device_name, wifi_channel, 
                            last_seen, status, created_at, session_duration, 
                            session_start_time, session_remaining, battery_level, 
                            battery_charging, display_mode, current_pilot_id, 
                            current_pilot_name, current_ticket_id, current_session_id, 
                            updated_at
                        )
                        SELECT 
                            id, device_id, mac_address, device_name, wifi_channel, 
                            last_seen, status, created_at, session_duration, 
                            session_start_time, session_remaining, battery_level, 
                            battery_charging, display_mode, current_pilot_id, 
                            current_pilot_name, current_ticket_id, current_session_id, 
                            CURRENT_TIMESTAMP
                        FROM devices
                    `, (err) => {
                        if (err) {
                            console.error('❌ Error copying data to temporary table:', err.message);
                            process.exit(1);
                        }
                        
                        // Drop the old table
                        db.run("DROP TABLE devices", (err) => {
                            if (err) {
                                console.error('❌ Error dropping old devices table:', err.message);
                                process.exit(1);
                            }
                            
                            // Rename the new table
                            db.run("ALTER TABLE devices_temp RENAME TO devices", (err) => {
                                if (err) {
                                    console.error('❌ Error renaming temporary table:', err.message);
                                    process.exit(1);
                                }
                                
                                console.log('✅ Successfully added updated_at column with default value');
                                process.exit(0);
                            });
                        });
                    });
                });
            });
        });
    });
});

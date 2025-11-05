const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./devices.db');

console.log('🔍 Checking pit_lane_registrations table...');

// Check the structure of the pit_lane_registrations table
db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='pit_lane_registrations'", (err, tableInfo) => {
    if (err) {
        console.error('❌ Error getting table structure:', err.message);
        return process.exit(1);
    }
    
    console.log('\nTable structure:');
    console.log(tableInfo.sql);
    
    // Get some sample data
    console.log('\nSample data (first 5 rows):');
    db.all(`
        SELECT 
            registration_id,
            pilot_id,
            pilot_name,
            pilot_display_name,
            device_id,
            device_name,
            ticket_id,
            status,
            check_in_time
        FROM pit_lane_registrations
        ORDER BY check_in_time DESC
        LIMIT 5
    `, [], (err, rows) => {
        if (err) {
            console.error('❌ Error getting sample data:', err.message);
            return process.exit(1);
        }
        
        console.log(JSON.stringify(rows, null, 2));
        
        // Check if we have any data
        if (rows.length === 0) {
            console.log('\n⚠️ No data found in pit_lane_registrations table!');
            return process.exit(0);
        }
        
        // Check if we have the expected columns
        const firstRow = rows[0];
        console.log('\nAvailable columns in first row:');
        console.log(Object.keys(firstRow));
        
        // Check if we have pilot data
        console.log('\nPilot information in first row:');
        console.log({
            pilot_id: firstRow.pilot_id,
            pilot_name: firstRow.pilot_name,
            pilot_display_name: firstRow.pilot_display_name,
            has_pilot_name: !!firstRow.pilot_name,
            has_pilot_display_name: !!firstRow.pilot_display_name
        });
        
        process.exit(0);
    });
});

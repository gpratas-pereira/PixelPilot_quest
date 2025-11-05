const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./devices.db');

console.log('🔧 Applying migration to add pilot_display_name column...');

db.serialize(() => {
    // Add the new column
    db.run(`
        ALTER TABLE pit_lane_registrations 
        ADD COLUMN pilot_display_name TEXT;
    `, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
            console.error('❌ Error adding column:', err.message);
            process.exit(1);
        }
        
        // Update existing records
        db.run(`
            UPDATE pit_lane_registrations 
            SET pilot_display_name = pilot_name 
            WHERE pilot_display_name IS NULL;
        `, (err) => {
            if (err) {
                console.error('❌ Error updating records:', err.message);
                process.exit(1);
            }
            
            console.log('✅ Migration completed successfully!');
            process.exit(0);
        });
    });
});

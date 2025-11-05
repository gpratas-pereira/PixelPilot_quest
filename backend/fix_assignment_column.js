const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./devices.db');

console.log('🔧 Fixing current_assignment column in devices table...');

// 1. First, check if the column exists
db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='devices'", (err, tableInfo) => {
    if (err) {
        console.error('❌ Error checking table structure:', err.message);
        return process.exit(1);
    }

    const hasAssignmentColumn = tableInfo.sql.includes('current_assignment');
    
    if (hasAssignmentColumn) {
        console.log('✅ current_assignment column already exists');
    } else {
        // 2. Add the column if it doesn't exist
        console.log('Adding current_assignment column...');
        db.run(`
            ALTER TABLE devices 
            ADD COLUMN current_assignment TEXT DEFAULT '{}';
        `, function(err) {
            if (err) {
                console.error('❌ Error adding current_assignment column:', err.message);
                return process.exit(1);
            }
            console.log('✅ Successfully added current_assignment column');
        });
    }

    // 3. Ensure all devices have an empty object as default value
    db.run(`
        UPDATE devices 
        SET current_assignment = '{}' 
        WHERE current_assignment IS NULL OR current_assignment = '';
    `, function(err) {
        if (err) {
            console.error('❌ Error initializing current_assignment values:', err.message);
            return process.exit(1);
        }
        console.log('✅ Successfully initialized current_assignment values');
        console.log('\n🎉 Database migration completed successfully!');
        process.exit(0);
    });
});

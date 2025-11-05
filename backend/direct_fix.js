const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./devices.db');

console.log('🔧 Attempting to add current_assignment column...');

// 1. Try to add the column with a default empty object
db.run(`
    ALTER TABLE devices 
    ADD COLUMN current_assignment TEXT DEFAULT '{}';
`, function(err) {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('❌ Error adding column:', err.message);
        process.exit(1);
    }
    
    if (!err) {
        console.log('✅ Successfully added current_assignment column');
    } else {
        console.log('ℹ️ current_assignment column already exists');
    }
    
    // 2. Ensure all devices have the column initialized
    db.run(`
        UPDATE devices 
        SET current_assignment = '{}' 
        WHERE current_assignment IS NULL OR current_assignment = '';
    `, function(err) {
        if (err) {
            console.error('❌ Error initializing current_assignment values:', err.message);
            console.log('\n⚠️  The database might need manual repair. Please try these steps:');
            console.log('1. Stop the server');
            console.log('2. Make a backup of devices.db');
            console.log('3. Open the database with a SQLite browser');
            console.log('4. Run: ALTER TABLE devices ADD COLUMN current_assignment TEXT DEFAULT \'{}\';');
            process.exit(1);
        }
        
        console.log('✅ Successfully initialized current_assignment values');
        console.log('\n🎉 Database fix completed successfully! Please restart your server.');
        process.exit(0);
    });
});

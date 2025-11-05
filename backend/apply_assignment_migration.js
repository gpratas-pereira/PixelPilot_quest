const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./devices.db');

console.log('🔧 Applying migration to add current_assignment column to devices table...');

// First, try to add the column directly
db.run(`
    ALTER TABLE devices 
    ADD COLUMN current_assignment TEXT DEFAULT '{}';
`, function(err) {
    if (err && !err.message.includes('duplicate column name')) {
        console.error('❌ Error adding current_assignment column:', err.message);
        process.exit(1);
    }
    
    if (!err) {
        console.log('✅ Successfully added current_assignment column to devices table');
    } else {
        console.log('ℹ️ current_assignment column already exists');
    }

        // Add the new column
        console.log('Adding current_assignment column...');
        db.run(`
            ALTER TABLE devices 
            ADD COLUMN current_assignment TEXT;
        `, (err) => {
            if (err) {
                console.error('❌ Error adding current_assignment column:', err.message);
                process.exit(1);
            }
            
            console.log('✅ Successfully added current_assignment column to devices table');
            
            // Initialize existing records with empty JSON object
            db.run(`
                UPDATE devices 
                SET current_assignment = '{}' 
                WHERE current_assignment IS NULL;
            `, (err) => {
                if (err) {
                    console.error('❌ Error initializing current_assignment:', err.message);
                    process.exit(1);
                }
                
                console.log('✅ Successfully initialized current_assignment for existing records');
                process.exit(0);
            });
        });
    });
});

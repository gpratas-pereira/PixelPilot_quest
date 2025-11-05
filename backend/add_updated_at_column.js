const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

// First, try to add the column directly
db.run("ALTER TABLE devices ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP", (err) => {
    if (err) {
        if (err.message.includes('duplicate column name: updated_at')) {
            console.log('updated_at column already exists in devices table');
            process.exit(0);
        } else {
            console.error('Error adding column:', err);
            process.exit(1);
        }
    } else {
        console.log('Successfully added updated_at column to devices table');
        process.exit(0);
    }
});

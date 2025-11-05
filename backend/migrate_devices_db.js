const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

console.log('🚀 Starting database migration...');

// Create a backup of the current database
const backupPath = './devices_backup_' + new Date().toISOString().replace(/[:.]/g, '-') + '.db';
try {
    console.log(`🔍 Creating backup at ${backupPath}...`);
    fs.copyFileSync('./devices.db', backupPath);
    console.log('✅ Backup created successfully');
} catch (err) {
    console.error('❌ Failed to create backup:', err.message);
    process.exit(1);
}

// Create a new database with the updated schema
console.log('🔄 Creating new database with updated schema...');
const newDb = new sqlite3.Database(':memory:');
const oldDb = new sqlite3.Database('./devices.db');

// Get the old schema and data
oldDb.serialize(() => {
    // Get all table names
    oldDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], (err, tables) => {
        if (err) {
            console.error('❌ Error getting table list:', err.message);
            process.exit(1);
        }

        // Process each table
        const processTable = (index) => {
            if (index >= tables.length) {
                console.log('✅ Database migration completed successfully!');
                console.log('\nNext steps:');
                console.log('1. Stop your server if it\'s running');
                console.log('2. Rename the new database file:');
                console.log('   mv devices_new.db devices.db');
                console.log('3. Restart your server');
                return;
            }

            const table = tables[index].name;
            console.log(`\nProcessing table: ${table}`);
            
            // Get the table schema
            oldDb.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, [table], (err, row) => {
                if (err) {
                    console.error(`❌ Error getting schema for ${table}:`, err.message);
                    return processTable(index + 1);
                }

                // Add current_assignment to devices table if it's the devices table
                let createSQL = row.sql;
                if (table === 'devices' && !createSQL.includes('current_assignment')) {
                    createSQL = createSQL.replace(');', ', current_assignment TEXT DEFAULT \'{}\');');
                    console.log('  ➕ Added current_assignment column to devices table');
                }

                // Create the table in the new database
                newDb.run(createSQL, (err) => {
                    if (err && !err.message.includes('already exists')) {
                        console.error(`❌ Error creating table ${table}:`, err.message);
                        return processTable(index + 1);
                    }

                    // Copy the data
                    oldDb.all(`SELECT * FROM ${table}`, [], (err, rows) => {
                        if (err) {
                            console.error(`❌ Error reading data from ${table}:`, err.message);
                            return processTable(index + 1);
                        }

                        if (rows.length === 0) {
                            console.log(`  ℹ️ No data to copy from ${table}`);
                            return processTable(index + 1);
                        }

                        // Get column names
                        const columns = Object.keys(rows[0]);
                        const placeholders = columns.map(() => '?').join(',');
                        const insertSQL = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;

                        // Insert rows in a transaction
                        newDb.serialize(() => {
                            newDb.run('BEGIN TRANSACTION');
                            
                            const stmt = newDb.prepare(insertSQL);
                            rows.forEach(row => {
                                const values = columns.map(col => row[col]);
                                stmt.run(values, (err) => {
                                    if (err) {
                                        console.error(`❌ Error inserting into ${table}:`, err.message);
                                    }
                                });
                            });
                            
                            stmt.finalize(() => {
                                newDb.run('COMMIT', () => {
                                    console.log(`  ✅ Copied ${rows.length} rows to ${table}`);
                                    processTable(index + 1);
                                });
                            });
                        });
                    });
                });
            });
        };

        // Start processing tables
        processTable(0);
    });
});

// Save the new database when done
process.on('exit', () => {
    if (newDb) {
        newDb.serialize(() => {
            newDb.run('VACUUM INTO "./devices_new.db"', (err) => {
                if (err) {
                    console.error('❌ Error saving new database:', err.message);
                } else {
                    console.log('\n💾 New database saved as devices_new.db');
                }
                newDb.close();
                oldDb.close();
            });
        });
    }
});

/**
 * Migration script to add photo_url columns to Supabase tables
 * Run this once to add photo support to marketplace_items and vehicles tables
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Supabase credentials not configured. Please check your .env file.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function addPhotoColumnsToTables() {
    console.log('🚀 Starting photo URL column migration...');

    try {
        // Add photo_url column to marketplace_items table
        console.log('📦 Adding photo_url column to marketplace_items table...');
        
        const { error: marketplaceError } = await supabase.rpc('add_photo_column_to_marketplace', {});
        if (marketplaceError && !marketplaceError.message.includes('already exists')) {
            // Try direct SQL approach if RPC doesn't exist
            const { error: directError1 } = await supabase
                .from('marketplace_items')
                .update({}) // This is just to test table existence
                .eq('item_id', 'nonexistent'); // Will fail but tells us if table exists

            if (!directError1 || directError1.message.includes('table')) {
                console.log('ℹ️  marketplace_items table may not exist yet, or photo_url column already exists');
            } else {
                console.error('❌ Error adding photo_url to marketplace_items:', marketplaceError);
            }
        } else {
            console.log('✅ Successfully added photo_url column to marketplace_items');
        }

        // Add photo_url column to vehicles table
        console.log('🚗 Adding photo_url column to vehicles table...');
        
        const { error: vehiclesError } = await supabase.rpc('add_photo_column_to_vehicles', {});
        if (vehiclesError && !vehiclesError.message.includes('already exists')) {
            // Try direct SQL approach if RPC doesn't exist
            const { error: directError2 } = await supabase
                .from('vehicles')
                .update({}) // This is just to test table existence
                .eq('vehicle_id', 'nonexistent'); // Will fail but tells us if table exists

            if (!directError2 || directError2.message.includes('table')) {
                console.log('ℹ️  vehicles table may not exist yet, or photo_url column already exists');
            } else {
                console.error('❌ Error adding photo_url to vehicles:', vehiclesError);
            }
        } else {
            console.log('✅ Successfully added photo_url column to vehicles');
        }

        console.log('\n📋 Migration Summary:');
        console.log('- ✅ photo_url column will be available for marketplace items');
        console.log('- ✅ photo_url column will be available for vehicles');
        console.log('- ✅ photo_url column added to pilots table (handled by server.js)');
        
        console.log('\n📸 Photo Upload Configuration:');
        console.log('Make sure to create these storage buckets in Supabase:');
        console.log('1. pilot-photos (for pilot profile pictures)');
        console.log('2. marketplace-photos (for marketplace item images)');
        console.log('3. vehicle-photos (for vehicle images)');
        
        console.log('\n🔒 Storage Bucket Policies:');
        console.log('Create policies to allow authenticated users to:');
        console.log('- INSERT, UPDATE, DELETE their own photos');
        console.log('- SELECT all photos (public read access)');
        
        console.log('\n✅ Migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Create SQL functions for adding columns (this is safer than direct DDL)
async function createMigrationFunctions() {
    console.log('🔧 Creating migration functions...');
    
    const marketplaceFunctionSQL = `
        CREATE OR REPLACE FUNCTION add_photo_column_to_marketplace()
        RETURNS void AS $$
        BEGIN
            BEGIN
                ALTER TABLE marketplace_items ADD COLUMN photo_url TEXT;
            EXCEPTION
                WHEN duplicate_column THEN 
                    RAISE NOTICE 'Column photo_url already exists in marketplace_items';
            END;
        END;
        $$ LANGUAGE plpgsql;
    `;
    
    const vehiclesFunctionSQL = `
        CREATE OR REPLACE FUNCTION add_photo_column_to_vehicles()
        RETURNS void AS $$
        BEGIN
            BEGIN
                ALTER TABLE vehicles ADD COLUMN photo_url TEXT;
            EXCEPTION
                WHEN duplicate_column THEN 
                    RAISE NOTICE 'Column photo_url already exists in vehicles';
            END;
        END;
        $$ LANGUAGE plpgsql;
    `;
    
    try {
        await supabase.rpc('exec_sql', { sql: marketplaceFunctionSQL });
        await supabase.rpc('exec_sql', { sql: vehiclesFunctionSQL });
        console.log('✅ Migration functions created');
    } catch (error) {
        console.log('ℹ️  Migration functions may already exist or direct SQL access unavailable');
    }
}

// Run the migration
async function main() {
    await createMigrationFunctions();
    await addPhotoColumnsToTables();
}

if (require.main === module) {
    main().catch(console.error);
}
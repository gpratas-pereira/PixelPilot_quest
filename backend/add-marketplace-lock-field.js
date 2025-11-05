#!/usr/bin/env node
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function addLockField() {
    console.log('🔐 Adding lock/unlock field to marketplace_items table...');
    
    try {
        // First, let's check if the field already exists by trying to select it
        const { data: testData, error: testError } = await supabase
            .from('marketplace_items')
            .select('is_locked')
            .limit(1);
            
        if (!testError) {
            console.log('✅ Lock field already exists');
            return true;
        }
        
        // If the field doesn't exist, we'll get an error. Let's try to add it using a simple approach
        console.log('📝 Field does not exist, you will need to add it manually in Supabase dashboard:');
        console.log('   1. Go to your Supabase dashboard');
        console.log('   2. Navigate to Table Editor > marketplace_items');
        console.log('   3. Add a new column:');
        console.log('      - Name: is_locked');
        console.log('      - Type: boolean');
        console.log('      - Default value: false');
        console.log('      - Description: When true, item is locked and not available for purchase');
        
        // Let's try to check the current table structure
        const { data: existingData, error: existingError } = await supabase
            .from('marketplace_items')
            .select('*')
            .limit(1);
            
        if (existingError) {
            console.error('❌ Error checking table structure:', existingError);
            return false;
        }
        
        if (existingData && existingData.length > 0) {
            console.log('📊 Current table structure:');
            console.log('Columns:', Object.keys(existingData[0]));
        }
        
        return false; // Return false so user can manually add the field
    } catch (err) {
        console.error('❌ Failed to add lock field:', err);
        return false;
    }
}

async function verifyField() {
    console.log('🔍 Verifying lock field...');
    
    try {
        // Check the current structure
        const { data, error } = await supabase
            .from('marketplace_items')
            .select('*')
            .limit(1);
            
        if (error) {
            console.error('❌ Error verifying field:', error);
            return false;
        }
        
        if (data && data.length > 0) {
            const hasLockField = data[0].hasOwnProperty('is_locked');
            if (hasLockField) {
                console.log('✅ Lock field verified successfully');
                return true;
            } else {
                console.error('❌ Lock field not found in table structure');
                return false;
            }
        } else {
            console.log('⚠️  No data in marketplace_items table to verify structure');
            return true;
        }
    } catch (err) {
        console.error('❌ Failed to verify field:', err);
        return false;
    }
}

async function main() {
    console.log('🎯 Adding lock/unlock functionality to marketplace_items...\n');
    
    if (!(await addLockField())) {
        process.exit(1);
    }
    
    if (!(await verifyField())) {
        process.exit(1);
    }
    
    console.log('\n🎉 Lock field added successfully!');
    console.log('💡 The is_locked field controls item availability:');
    console.log('   - false (default): Item is available for purchase');
    console.log('   - true: Item is locked and not available for purchase');
}

if (require.main === module) {
    main();
}

module.exports = { addLockField, verifyField };
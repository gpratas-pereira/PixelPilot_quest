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

async function checkDatabaseStructure() {
    console.log('🔍 Checking current marketplace_items structure...');
    
    try {
        const { data, error } = await supabase
            .from('marketplace_items')
            .select('*')
            .limit(1);
            
        if (error) {
            console.error('❌ Error checking table structure:', error);
            return false;
        }
        
        if (data && data.length > 0) {
            console.log('📊 Current columns:', Object.keys(data[0]));
            const hasLockField = data[0].hasOwnProperty('is_locked');
            console.log('🔒 has is_locked field:', hasLockField);
            
            if (hasLockField) {
                console.log('✅ is_locked field exists');
                return true;
            } else {
                console.log('❌ is_locked field is missing');
                return false;
            }
        } else {
            console.log('⚠️  No data in marketplace_items table');
            return false;
        }
    } catch (err) {
        console.error('❌ Failed to check database structure:', err);
        return false;
    }
}

async function testAdminAPI() {
    console.log('\n🧪 Testing admin API endpoint...');
    
    try {
        // Simulate the admin API call
        const { data, error } = await supabase
            .from('marketplace_items')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('❌ Error fetching items:', error);
            return;
        }
        
        console.log(`📦 Found ${data ? data.length : 0} total items`);
        
        if (data && data.length > 0) {
            console.log('\n📋 Item details:');
            data.forEach((item, index) => {
                console.log(`${index + 1}. ${item.name}`);
                console.log(`   - Active: ${item.is_active}`);
                console.log(`   - Locked: ${item.is_locked || 'undefined'}`);
                console.log(`   - ID: ${item.item_id}`);
            });
            
            const lockedItems = data.filter(item => item.is_locked === true);
            const unlockedItems = data.filter(item => item.is_locked !== true);
            
            console.log(`\n🔒 Locked items: ${lockedItems.length}`);
            console.log(`🔓 Unlocked items: ${unlockedItems.length}`);
            
            if (lockedItems.length > 0) {
                console.log('\n🚨 Locked items should still appear in admin interface!');
                console.log('If they don\'t appear, there might be a frontend JavaScript issue.');
            }
        }
        
    } catch (err) {
        console.error('❌ Failed to test admin API:', err);
    }
}

async function addMissingColumn() {
    console.log('\n➕ Attempting to add is_locked column...');
    console.log('⚠️  Note: This requires direct database access which may not work through Supabase JS client.');
    console.log('📝 You may need to add the column manually in Supabase dashboard:');
    console.log('   1. Go to Table Editor → marketplace_items');
    console.log('   2. Add column: is_locked (boolean, default: false)');
}

async function main() {
    console.log('🔧 Diagnosing locked items visibility issue...\n');
    
    const hasLockField = await checkDatabaseStructure();
    
    if (!hasLockField) {
        console.log('\n💡 SOLUTION: Add the is_locked column to marketplace_items table');
        await addMissingColumn();
        return;
    }
    
    await testAdminAPI();
    
    console.log('\n✨ If locked items still don\'t appear in admin interface:');
    console.log('   1. Check browser console for JavaScript errors');
    console.log('   2. Verify you\'re logged in as an admin user');
    console.log('   3. Check network tab for failed API calls');
    console.log('   4. Try refreshing the admin page');
}

if (require.main === module) {
    main();
}

module.exports = { checkDatabaseStructure, testAdminAPI };
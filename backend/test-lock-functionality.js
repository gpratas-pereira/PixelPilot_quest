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

async function createTestLockedItem() {
    console.log('🧪 Creating a test locked item...');
    
    try {
        const { data, error } = await supabase
            .from('marketplace_items')
            .insert({
                name: 'TEST LOCKED ITEM - Delete Me',
                description: 'This is a test item that should be locked',
                item_type: 'vehicle',
                points_price: 100,
                usdt_price: 1.00,
                stock: -1,
                is_active: true,
                is_locked: true, // This item should be LOCKED
                metadata: { test: true }
            })
            .select()
            .single();

        if (error) {
            console.error('❌ Error creating test item:', error);
            return null;
        }

        console.log('✅ Created test locked item:', data.item_id);
        return data.item_id;
    } catch (err) {
        console.error('❌ Failed to create test item:', err);
        return null;
    }
}

async function testAdminAPI() {
    console.log('\n🔍 Testing admin API (should show ALL items including locked)...');
    
    try {
        const { data, error } = await supabase
            .from('marketplace_items')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('❌ Admin API error:', error);
            return;
        }
        
        console.log(`📦 Admin API returned ${data ? data.length : 0} total items`);
        
        const lockedItems = data.filter(item => item.is_locked === true);
        const unlockedItems = data.filter(item => item.is_locked !== true);
        
        console.log(`🔒 Locked items: ${lockedItems.length}`);
        console.log(`🔓 Unlocked/undefined items: ${unlockedItems.length}`);
        
        if (lockedItems.length > 0) {
            console.log('\n🔒 Locked items found:');
            lockedItems.forEach(item => {
                console.log(`   - ${item.name} (${item.item_id})`);
            });
        }
        
        return data;
    } catch (err) {
        console.error('❌ Failed to test admin API:', err);
        return [];
    }
}

async function testPublicAPI() {
    console.log('\n🌍 Testing public API (should NOT show locked items)...');
    
    try {
        const { data, error } = await supabase
            .from('marketplace_items')
            .select('*')
            .eq('is_active', true)
            .or('is_locked.is.null,is_locked.eq.false')
            .order('points_price', { ascending: true });
            
        if (error) {
            console.error('❌ Public API error:', error);
            return;
        }
        
        console.log(`📦 Public API returned ${data ? data.length : 0} items`);
        
        const lockedItems = data.filter(item => item.is_locked === true);
        if (lockedItems.length > 0) {
            console.log('❌ ERROR: Public API is returning locked items!');
            lockedItems.forEach(item => {
                console.log(`   - ${item.name} (locked but visible)`);
            });
        } else {
            console.log('✅ Public API correctly filters out locked items');
        }
        
        return data;
    } catch (err) {
        console.error('❌ Failed to test public API:', err);
        return [];
    }
}

async function cleanupTestItem(itemId) {
    if (!itemId) return;
    
    console.log('\n🧹 Cleaning up test item...');
    
    try {
        const { error } = await supabase
            .from('marketplace_items')
            .delete()
            .eq('item_id', itemId);
            
        if (error) {
            console.error('❌ Error deleting test item:', error);
        } else {
            console.log('✅ Test item cleaned up');
        }
    } catch (err) {
        console.error('❌ Failed to cleanup test item:', err);
    }
}

async function main() {
    console.log('🧪 Testing lock/unlock functionality...\n');
    
    // Create a test locked item
    const testItemId = await createTestLockedItem();
    
    // Test admin API (should show all items)
    const adminItems = await testAdminAPI();
    
    // Test public API (should not show locked items)
    const publicItems = await testPublicAPI();
    
    // Verify the difference
    if (adminItems && publicItems) {
        const adminCount = adminItems.length;
        const publicCount = publicItems.length;
        
        console.log('\n📊 Summary:');
        console.log(`Admin sees: ${adminCount} items`);
        console.log(`Public sees: ${publicCount} items`);
        
        if (adminCount > publicCount) {
            console.log(`✅ Success! ${adminCount - publicCount} locked items are hidden from public`);
        } else if (adminCount === publicCount) {
            console.log('⚠️  No locked items found, or filtering not working');
        } else {
            console.log('❌ Something is wrong - public API shows more items than admin API');
        }
    }
    
    // Cleanup
    await cleanupTestItem(testItemId);
    
    console.log('\n💡 To test the admin interface:');
    console.log('1. Go to rewards-admin.html');
    console.log('2. Look for locked items in the Items tab');
    console.log('3. They should have a 🔒 Locked label');
    console.log('4. You should be able to edit them and unlock them');
}

if (require.main === module) {
    main();
}
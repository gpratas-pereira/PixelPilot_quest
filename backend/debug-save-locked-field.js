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

async function createTestItem() {
    console.log('🧪 Creating test item...');
    
    try {
        const { data, error } = await supabase
            .from('marketplace_items')
            .insert({
                name: 'DEBUG TEST ITEM',
                description: 'Test item for debugging save functionality',
                item_type: 'vehicle',
                points_price: 50,
                usdt_price: 0.50,
                stock: -1,
                is_active: true,
                is_locked: false,
                metadata: { debug: true }
            })
            .select()
            .single();

        if (error) {
            console.error('❌ Error creating test item:', error);
            return null;
        }

        console.log('✅ Created test item:', data.item_id);
        console.log('Initial state:');
        console.log('  - is_active:', data.is_active);
        console.log('  - is_locked:', data.is_locked);
        return data;
    } catch (err) {
        console.error('❌ Failed to create test item:', err);
        return null;
    }
}

async function testUpdateLocked(itemId, lockState) {
    console.log(`\n🔄 Testing update to set is_locked = ${lockState}...`);
    
    try {
        // Simulate exactly what the frontend sends
        const payload = {
            name: 'DEBUG TEST ITEM UPDATED',
            description: 'Test item for debugging save functionality',
            item_type: 'vehicle',
            points_price: 50,
            usdt_price: 0.50,
            stock: -1,
            is_active: true,
            is_locked: lockState
        };

        console.log('📤 Payload being sent:');
        console.log(JSON.stringify(payload, null, 2));

        // Test the exact same update logic as the backend
        const updateData = {};
        if (payload.name !== undefined) updateData.name = payload.name;
        if (payload.description !== undefined) updateData.description = payload.description;
        if (payload.item_type !== undefined) updateData.item_type = payload.item_type;
        if (payload.points_price !== undefined) updateData.points_price = payload.points_price || null;
        if (payload.usdt_price !== undefined) updateData.usdt_price = payload.usdt_price || null;
        if (payload.stock !== undefined) updateData.stock = payload.stock;
        if (payload.is_active !== undefined) updateData.is_active = payload.is_active;
        if (payload.is_locked !== undefined) updateData.is_locked = payload.is_locked;

        console.log('📝 Update data prepared:');
        console.log(JSON.stringify(updateData, null, 2));

        const { data, error } = await supabase
            .from('marketplace_items')
            .update(updateData)
            .eq('item_id', itemId)
            .select()
            .single();

        if (error) {
            console.error('❌ Update error:', error);
            return null;
        }

        console.log('✅ Update successful!');
        console.log('Updated state:');
        console.log('  - is_active:', data.is_active);
        console.log('  - is_locked:', data.is_locked);
        
        return data;
    } catch (err) {
        console.error('❌ Failed to update item:', err);
        return null;
    }
}

async function verifyCurrentState(itemId) {
    console.log('\n🔍 Verifying current state in database...');
    
    try {
        const { data, error } = await supabase
            .from('marketplace_items')
            .select('item_id, name, is_active, is_locked')
            .eq('item_id', itemId)
            .single();

        if (error) {
            console.error('❌ Error fetching current state:', error);
            return null;
        }

        console.log('📊 Current database state:');
        console.log('  - item_id:', data.item_id);
        console.log('  - name:', data.name);
        console.log('  - is_active:', data.is_active);
        console.log('  - is_locked:', data.is_locked);
        
        return data;
    } catch (err) {
        console.error('❌ Failed to verify state:', err);
        return null;
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
    console.log('🔍 Debugging is_locked field save functionality...\n');
    
    // Step 1: Create test item
    const testItem = await createTestItem();
    if (!testItem) {
        console.error('❌ Cannot proceed without test item');
        return;
    }

    // Step 2: Try to lock the item (set is_locked = true)
    console.log('\n' + '='.repeat(60));
    const lockedItem = await testUpdateLocked(testItem.item_id, true);
    
    // Step 3: Verify the state
    const verifiedLocked = await verifyCurrentState(testItem.item_id);
    
    if (verifiedLocked && verifiedLocked.is_locked === true) {
        console.log('✅ SUCCESS: Item is now locked');
    } else {
        console.log('❌ FAILED: Item is not locked');
    }

    // Step 4: Try to unlock the item (set is_locked = false)
    console.log('\n' + '='.repeat(60));
    const unlockedItem = await testUpdateLocked(testItem.item_id, false);
    
    // Step 5: Verify the state again
    const verifiedUnlocked = await verifyCurrentState(testItem.item_id);
    
    if (verifiedUnlocked && verifiedUnlocked.is_locked === false) {
        console.log('✅ SUCCESS: Item is now unlocked');
    } else {
        console.log('❌ FAILED: Item is not unlocked');
    }

    // Cleanup
    await cleanupTestItem(testItem.item_id);
    
    console.log('\n💡 If updates are failing, check:');
    console.log('1. Database constraints on is_locked field');
    console.log('2. RLS (Row Level Security) policies in Supabase');
    console.log('3. Admin user permissions');
    console.log('4. Frontend JavaScript console for errors');
}

if (require.main === module) {
    main();
}
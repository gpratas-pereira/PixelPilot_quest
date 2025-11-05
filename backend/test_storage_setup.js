/**
 * Test script to verify Supabase storage setup
 * Run: node test_storage_setup.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Supabase credentials not configured. Please check your .env file.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testStorageSetup() {
    console.log('🧪 Testing Supabase storage setup...\n');

    try {
        // Test bucket listing
        console.log('1. Testing bucket access...');
        const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
        
        if (bucketsError) {
            console.error('❌ Error listing buckets:', bucketsError);
            return;
        }

        const requiredBuckets = ['pilot-photos', 'marketplace-photos', 'vehicle-photos'];
        const existingBuckets = buckets.map(b => b.name);
        
        console.log('📦 Existing buckets:', existingBuckets);
        
        for (const bucket of requiredBuckets) {
            if (existingBuckets.includes(bucket)) {
                console.log(`✅ ${bucket} bucket exists`);
            } else {
                console.log(`❌ ${bucket} bucket missing`);
            }
        }

        // Test authentication requirement
        console.log('\n2. Testing authentication requirement...');
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
            console.log(`✅ User authenticated: ${user.email}`);
            
            // Test bucket policies with a small test file
            console.log('\n3. Testing upload permissions...');
            const testFile = new Blob(['test content'], { type: 'text/plain' });
            const testPath = `${user.id}/test.txt`;
            
            const { data, error } = await supabase.storage
                .from('pilot-photos')
                .upload(testPath, testFile, { upsert: true });
                
            if (error) {
                console.error('❌ Upload test failed:', error.message);
                if (error.message.includes('violates row-level security')) {
                    console.log('💡 This suggests RLS policies need to be configured');
                }
            } else {
                console.log('✅ Upload test successful');
                
                // Clean up test file
                await supabase.storage.from('pilot-photos').remove([testPath]);
                console.log('🧹 Test file cleaned up');
            }
        } else {
            console.log('⚠️  No user authenticated - this is expected for testing');
            console.log('💡 To test uploads, sign in through your app first');
        }

        console.log('\n📋 Storage Setup Summary:');
        console.log('- Bucket access: ' + (bucketsError ? '❌' : '✅'));
        console.log('- Required buckets: ' + (requiredBuckets.every(b => existingBuckets.includes(b)) ? '✅' : '❌'));
        console.log('- Authentication: ' + (user ? '✅' : '⚠️  (not signed in)'));

        if (!requiredBuckets.every(b => existingBuckets.includes(b))) {
            console.log('\n🔧 Next Steps:');
            console.log('1. Run the SQL script: setup_storage_buckets.sql');
            console.log('2. Make sure storage buckets are created in Supabase Dashboard');
            console.log('3. Verify RLS policies are configured correctly');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

if (require.main === module) {
    testStorageSetup();
}
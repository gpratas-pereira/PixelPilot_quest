#!/usr/bin/env node
// Test script to check if the marketplace API is accessible

async function testMarketplaceAPI() {
    try {
        console.log('🧪 Testing marketplace API endpoint...');
        
        const response = await fetch('http://localhost:3000/api/rewards/marketplace');
        console.log('📡 Response status:', response.status, response.statusText);
        console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error:', errorText);
            return;
        }
        
        const data = await response.json();
        console.log('✅ API Success! Data:', JSON.stringify(data, null, 2));
        console.log(`📦 Items returned: ${data.items ? data.items.length : 0}`);
        
        if (data.items && data.items.length > 0) {
            console.log('\n📋 Items summary:');
            data.items.forEach((item, i) => {
                console.log(`${i + 1}. ${item.name} (${item.is_locked ? 'LOCKED' : 'unlocked'})`);
            });
        }
        
    } catch (err) {
        console.error('❌ Test failed:', err.message);
        console.error('💡 Make sure the server is running on localhost:3000');
    }
}

testMarketplaceAPI();
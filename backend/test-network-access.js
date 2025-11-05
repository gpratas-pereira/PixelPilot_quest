#!/usr/bin/env node

// Network access testing tool for FPVue Device Manager
// Run this to test network connectivity and configuration

const os = require('os');
const { exec } = require('child_process');
const net = require('net');

console.log('\n🌐 FPVue Device Manager - Network Access Tester');
console.log('================================================');

// Get network interfaces
function getNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    const result = {};
    
    Object.keys(interfaces).forEach(name => {
        interfaces[name].forEach(net => {
            if (net.family === 'IPv4' && !net.internal) {
                result[name] = net.address;
            }
        });
    });
    
    return result;
}

// Test if port is accessible
function testPort(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        
        socket.connect(port, host, () => {
            socket.destroy();
            resolve(true);
        });
        
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

// Main testing function
async function runTests() {
    const PORT = 3000;
    
    console.log(`\n📍 Network Information:`);
    console.log(`- Hostname: ${os.hostname()}`);
    console.log(`- Platform: ${os.platform()}`);
    console.log(`- Architecture: ${os.arch()}`);
    
    const interfaces = getNetworkInterfaces();
    console.log(`\n📡 Network Interfaces:`);
    Object.keys(interfaces).forEach(name => {
        console.log(`- ${name}: ${interfaces[name]}`);
    });
    
    console.log(`\n🔍 Testing Port ${PORT} Accessibility:`);
    
    // Test localhost
    const localhostTest = await testPort('localhost', PORT);
    console.log(`- localhost:${PORT} - ${localhostTest ? '✅ ACCESSIBLE' : '❌ NOT ACCESSIBLE'}`);
    
    // Test 127.0.0.1
    const loopbackTest = await testPort('127.0.0.1', PORT);
    console.log(`- 127.0.0.1:${PORT} - ${loopbackTest ? '✅ ACCESSIBLE' : '❌ NOT ACCESSIBLE'}`);
    
    // Test network interfaces
    for (const [name, ip] of Object.entries(interfaces)) {
        const interfaceTest = await testPort(ip, PORT);
        console.log(`- ${ip}:${PORT} (${name}) - ${interfaceTest ? '✅ ACCESSIBLE' : '❌ NOT ACCESSIBLE'}`);
    }
    
    console.log(`\n🔧 Configuration Status:`);
    
    // Check if server is running
    if (localhostTest) {
        console.log('✅ FPVue server is running locally');
    } else {
        console.log('❌ FPVue server is not running - start with: npm start');
        return;
    }
    
    // Check if bound to all interfaces
    if (Object.values(interfaces).length > 0) {
        const externalAccessible = Object.values(interfaces).some(async (ip) => {
            return await testPort(ip, PORT);
        });
        
        if (externalAccessible) {
            console.log('✅ Server is bound to external interfaces');
        } else {
            console.log('❌ Server may not be bound to external interfaces');
        }
    }
    
    console.log(`\n📱 Device Configuration:`);
    console.log('Update your FPVue app with one of these URLs:');
    Object.entries(interfaces).forEach(([name, ip]) => {
        console.log(`- http://${ip}:${PORT} (${name})`);
    });
    
    console.log(`\n🌐 Windows Port Forwarding Setup:`);
    console.log('Run these commands in PowerShell as Administrator:');
    
    // Get the first interface IP (usually the main one)
    const firstInterface = Object.values(interfaces)[0];
    if (firstInterface) {
        console.log(`\n1. Set up port forwarding:`);
        console.log(`   netsh interface portproxy add v4tov4 listenport=${PORT} listenaddress=0.0.0.0 connectport=${PORT} connectaddress=${firstInterface}`);
        
        console.log(`\n2. Add firewall rule:`);
        console.log(`   New-NetFirewallRule -DisplayName "FPVue Device Manager" -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow -Profile Any`);
        
        console.log(`\n3. Get Windows IP address:`);
        console.log(`   (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress`);
    }
    
    console.log(`\n🧪 Testing Commands:`);
    console.log('Test from external device:');
    console.log(`  curl http://[WINDOWS_IP]:${PORT}`);
    console.log(`  curl http://[WINDOWS_IP]:${PORT}/api/devices`);
    
    console.log(`\n💡 Troubleshooting Tips:`);
    console.log('- Ensure Windows Defender allows port 3000');
    console.log('- Check router firewall settings');
    console.log('- Verify devices are on the same network');
    console.log('- Test with Windows IP, not WSL IP');
    console.log('- Use PowerShell script for automatic setup');
}

// Run the tests
runTests().catch(console.error);
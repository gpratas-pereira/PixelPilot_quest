# FPVue Rewards System - Deployment Guide

## 🚀 Quick Start

This guide will help you deploy the complete rewards and vehicle management system.

---

## 📋 Prerequisites

- ✅ Supabase account and project
- ✅ Node.js 16+ installed
- ✅ PostgreSQL database (via Supabase)
- ✅ Admin email addresses configured

---

## 🗄️ Step 1: Database Setup

### 1.1 Run Migration in Supabase

1. Open your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the migration file: `backend/migrations/001_rewards_system.sql`
4. Copy the entire contents
5. Paste into Supabase SQL Editor
6. Click **Run** to execute the migration

**What this creates:**
- ✅ 9 new tables (pilot_points, marketplace_items, achievements, etc.)
- ✅ Row Level Security (RLS) policies
- ✅ Indexes for performance
- ✅ Triggers for updated_at timestamps
- ✅ Seed data (default point rules, sample achievements, marketplace items)

### 1.2 Verify Tables Created

Run this query in Supabase SQL Editor:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'pilot_points',
    'marketplace_items',
    'achievements',
    'pilot_achievements',
    'point_rules',
    'point_transactions',
    'marketplace_purchases',
    'usdt_point_purchases',
    'vehicles'
);
```

You should see all 9 tables listed.

---

## ⚙️ Step 2: Environment Configuration

### 2.1 Update `.env` File

Add/verify these variables in `backend/.env`:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# Admin Configuration
ADMIN_EMAILS=admin@example.com,crew@racecontrol.com

# Payment Configuration
PAYMENT_USDT_ADDRESS=your-usdt-wallet-address

# Server Configuration
PORT=3000
```

### 2.2 Get Supabase Keys

1. Go to **Project Settings** → **API**
2. Copy **Project URL** → `SUPABASE_URL`
3. Copy **anon public** key → `SUPABASE_ANON_KEY`
4. Copy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep secret!)

---

## 📦 Step 3: Install Dependencies

```bash
cd backend
npm install
```

**Required packages** (should already be in package.json):
- `express`
- `@supabase/supabase-js`
- `cors`
- `body-parser`
- `dotenv`

---

## 🔧 Step 4: Start the Server

```bash
cd backend
node server.js
```

You should see:
```
🚀 FPVue Device Manager running on:
- Local: http://localhost:3000
- Network: http://0.0.0.0:3000
```

---

## ✅ Step 5: Test the System

### 5.1 Test Public Config Endpoint

```bash
curl http://localhost:3000/api/public-config
```

Should return Supabase configuration.

### 5.2 Create Test User

1. Open `http://localhost:3000/tickets.html`
2. Click **Register**
3. Enter email and password
4. Check email for confirmation link
5. Confirm email and sign in

### 5.3 Test Pilot Profile

1. After signing in to tickets.html
2. Fill in **Display name** and **Vehicle/Car Asset ID**
3. Click **Save profile**
4. Profile should save successfully

### 5.4 Test Rewards Interface

1. Open `http://localhost:3000/rewards.html`
2. Sign in with the same credentials
3. You should see:
   - Points balance (0 initially)
   - Empty marketplace
   - No achievements unlocked yet
   - Wallet section

### 5.5 Test Admin Interface

1. Make sure your email is in `ADMIN_EMAILS` environment variable
2. Restart the server
3. Open `http://localhost:3000/rewards-admin.html`
4. Sign in with admin credentials
5. You should see:
   - Items tab with seed data
   - Achievements tab
   - Rules tab
   - Pilots tab

---

## 🧪 Step 6: Test API Endpoints

### Test Pilot Endpoints

```bash
# Get pilot's points (requires auth token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/rewards/points

# Get marketplace items
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/rewards/marketplace

# Get achievements
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/rewards/achievements/mine
```

### Test Admin Endpoints

```bash
# Get all items (requires admin auth)
curl -H "Authorization: Bearer ADMIN_TOKEN" \
     http://localhost:3000/api/admin/rewards/items

# Get all pilots
curl -H "Authorization: Bearer ADMIN_TOKEN" \
     http://localhost:3000/api/admin/rewards/pilots

# Award points manually
curl -X POST \
     -H "Authorization: Bearer ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"pilot_id":"USER_UUID","amount":100,"reason":"Test award"}' \
     http://localhost:3000/api/admin/rewards/award
```

---

## 🔗 Step 7: Integration with Session/Lap Tracking

### 7.1 Import Integration Utilities

In your session management code:

```javascript
const { onSessionComplete, onLapComplete } = require('./utils/rewards-integration');
```

### 7.2 Award Points on Session Complete

```javascript
// When a racing session ends
async function handleSessionEnd(deviceId, sessionData) {
    // Your existing session logic...
    
    // Award points
    await onSessionComplete(supabaseAdmin, deviceId, {
        session_id: sessionData.id,
        duration: sessionData.duration,
        laps: sessionData.laps
    });
}
```

### 7.3 Award Points on Lap Complete

```javascript
// When a lap is completed (from lap tracking system)
async function handleLapComplete(vehicleId, lapTime) {
    // Your existing lap logic...
    
    // Award points based on lap time
    await onLapComplete(supabaseAdmin, vehicleId, lapTime, {
        lap_id: lapData.id
    });
}
```

---

## 🎯 Step 8: Vehicle Assignment Flow

### 8.1 Pilot Sets Vehicle ID

1. Pilot opens `tickets.html`
2. Signs in
3. Enters **Vehicle/Car Asset ID** (e.g., "CAR-001")
4. Saves profile

### 8.2 Admin Manages Vehicles

1. Admin opens `rewards-admin.html`
2. Goes to **Pilots** tab
3. Searches for pilot
4. Clicks **Assign Vehicle** button
5. Enters vehicle ID
6. Vehicle is now linked to pilot

### 8.3 Lap Tracking Integration

When lap tracking system detects a lap:

```javascript
// Lap tracking system calls this
const vehicleId = "CAR-001"; // From transponder/tracker
const lapTime = 28500; // 28.5 seconds

// This automatically finds the pilot and awards points
await onLapComplete(supabaseAdmin, vehicleId, lapTime);
```

---

## 📊 Step 9: Monitoring and Maintenance

### Check Point Balances

```sql
SELECT 
    pp.pilot_id,
    prof.display_name,
    pp.current_points,
    pp.lifetime_earned,
    pp.total_spent
FROM pilot_points pp
LEFT JOIN pilot_profiles prof ON pp.pilot_id = prof.pilot_id
ORDER BY pp.lifetime_earned DESC
LIMIT 10;
```

### Check Recent Transactions

```sql
SELECT 
    pt.created_at,
    prof.display_name,
    pt.amount,
    pt.transaction_type,
    pt.description
FROM point_transactions pt
LEFT JOIN pilot_profiles prof ON pt.pilot_id = prof.pilot_id
ORDER BY pt.created_at DESC
LIMIT 20;
```

### Check Marketplace Purchases

```sql
SELECT 
    mp.purchased_at,
    prof.display_name,
    mi.name as item_name,
    mp.payment_method,
    mp.points_paid,
    mp.usdt_paid
FROM marketplace_purchases mp
LEFT JOIN pilot_profiles prof ON mp.pilot_id = prof.pilot_id
LEFT JOIN marketplace_items mi ON mp.item_id = mi.item_id
ORDER BY mp.purchased_at DESC
LIMIT 20;
```

### Check Vehicle Assignments

```sql
SELECT 
    pilot_id,
    display_name,
    vehicle_id
FROM pilot_profiles
WHERE vehicle_id IS NOT NULL
ORDER BY display_name;
```

---

## 🐛 Troubleshooting

### Issue: "Authentication required" errors

**Solution:**
- Verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly
- Check that Supabase project is active
- Ensure RLS policies are created (run migration again)

### Issue: Admin endpoints return 403 Forbidden

**Solution:**
- Check `ADMIN_EMAILS` environment variable
- Ensure admin email is lowercase
- Restart server after changing .env
- Sign in with the exact email in ADMIN_EMAILS

### Issue: Points not awarded automatically

**Solution:**
- Check that integration functions are called
- Verify vehicle_id is set in pilot profile
- Check server logs for errors
- Ensure point_rules table has active rules

### Issue: Marketplace items not showing

**Solution:**
- Check `is_active = true` in marketplace_items table
- Run seed data section of migration again
- Verify RLS policies allow reading

### Issue: Achievements not unlocking

**Solution:**
- Check achievement requirements in database
- Verify pilot_achievements table exists
- Check server logs for achievement processing errors
- Ensure achievements are marked as active

---

## 🔒 Security Checklist

- ✅ Never expose `SUPABASE_SERVICE_ROLE_KEY` to frontend
- ✅ Use `SUPABASE_ANON_KEY` for frontend authentication
- ✅ Keep admin emails list updated
- ✅ Enable RLS on all tables
- ✅ Validate all user inputs
- ✅ Use HTTPS in production
- ✅ Regularly backup database
- ✅ Monitor for suspicious transactions

---

## 📈 Performance Optimization

### Add Indexes for Large Datasets

```sql
-- If you have many pilots
CREATE INDEX idx_pilot_profiles_display_name ON pilot_profiles(display_name);

-- If you have many transactions
CREATE INDEX idx_point_transactions_created_at ON point_transactions(created_at DESC);

-- If you have many purchases
CREATE INDEX idx_marketplace_purchases_purchased_at ON marketplace_purchases(purchased_at DESC);
```

### Cache Frequently Accessed Data

Consider caching:
- Marketplace items list
- Active achievements
- Point rules
- Vehicle assignments

---

## 🚀 Production Deployment

### 1. Update Environment Variables

```env
NODE_ENV=production
PORT=3000
SUPABASE_URL=https://your-production-project.supabase.co
# ... other production values
```

### 2. Use Process Manager

```bash
# Install PM2
npm install -g pm2

# Start server with PM2
pm2 start server.js --name fpvue-rewards

# Enable auto-restart on server reboot
pm2 startup
pm2 save
```

### 3. Enable HTTPS

Use a reverse proxy like Nginx:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4. Monitor Logs

```bash
# View PM2 logs
pm2 logs fpvue-rewards

# View error logs only
pm2 logs fpvue-rewards --err

# Monitor in real-time
pm2 monit
```

---

## 📞 Support

For issues or questions:
1. Check this deployment guide
2. Review `REWARDS_SYSTEM.md` for system architecture
3. Check `IMPLEMENTATION_SUMMARY.md` for technical details
4. Review server logs for errors

---

## ✅ Deployment Complete!

Your FPVue Rewards System is now fully deployed and operational. Pilots can:
- ✅ Earn points through racing
- ✅ Purchase items from marketplace
- ✅ Unlock achievements
- ✅ Buy points with USDT
- ✅ Track their progress

Admins can:
- ✅ Manage marketplace items
- ✅ Configure achievements
- ✅ Award points manually
- ✅ Assign vehicles to pilots
- ✅ Monitor all activity

**Next Steps:**
1. Customize marketplace items for your track
2. Create custom achievements
3. Adjust point rules to your preferences
4. Integrate with your lap tracking system
5. Test the complete flow with real pilots

Happy Racing! 🏁

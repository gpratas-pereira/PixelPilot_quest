# FPVue Rewards & Marketplace System

## Overview

A comprehensive gamification and monetization system that rewards pilots for racing achievements and allows them to redeem points for exclusive items, features, and vehicles. The system integrates with the existing USDT wallet infrastructure for purchasing points and marketplace items.

## System Architecture

### 1. **Pilot-Facing Interface** (`rewards.html`)
The main interface where pilots can:
- View their reward points balance
- Browse and purchase marketplace items
- Track achievements and unlockables
- Manage their USDT wallet
- Buy points with USDT
- View transaction history

### 2. **Admin Management Interface** (`rewards-admin.html`)
Administrative dashboard for managing:
- Marketplace items (create, edit, delete)
- Achievements and unlockables
- Point earning rules
- Manual point awards to pilots
- System configuration

## Core Features

### Points System

**Earning Points:**
- Complete races and sessions
- Achieve lap time milestones
- Unlock achievements
- Participate in events
- Admin manual awards

**Spending Points:**
- Purchase marketplace items
- Unlock premium features
- Unlock new vehicles
- Buy cosmetic upgrades
- Purchase performance boosts

**USDT Integration:**
- Exchange rate: **1 USDT = 100 Points**
- Direct purchase from internal wallet
- Transaction history tracking
- Secure payment processing

### Marketplace Categories

#### 1. **Vehicles** 🏎️
- New drone models
- Performance variants
- Exclusive limited editions
- Unlockable through points or achievements

#### 2. **Features** ⚙️
- Advanced telemetry displays
- Custom HUD layouts
- Replay systems
- Data analysis tools
- VR enhancements

#### 3. **Cosmetics** 🎨
- Custom skins and liveries
- Visual effects
- UI themes
- Pilot avatars
- Celebration animations

#### 4. **Boosts** ⚡
- Temporary performance enhancements
- XP multipliers
- Point bonuses
- Time-limited advantages

### Achievement System

**Achievement Types:**
- **Performance**: Lap times, speeds, consistency
- **Milestones**: Total laps, flight hours, races completed
- **Special**: Event participation, community challenges
- **Progressive**: Multi-tier achievements with increasing rewards

**Rewards:**
- Points awards
- Exclusive item unlocks
- Special badges/titles
- Leaderboard recognition

## Database Schema

### Tables Required

```sql
-- Pilot Points
CREATE TABLE pilot_points (
    pilot_id UUID PRIMARY KEY REFERENCES auth.users(id),
    current_points INTEGER DEFAULT 0,
    lifetime_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Marketplace Items
CREATE TABLE marketplace_items (
    item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    item_type TEXT NOT NULL, -- vehicle, feature, cosmetic, boost
    points_price INTEGER,
    usdt_price DECIMAL(10,2),
    stock INTEGER DEFAULT -1, -- -1 for unlimited
    is_active BOOLEAN DEFAULT true,
    image_url TEXT,
    metadata JSONB, -- Additional item properties
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Achievements
CREATE TABLE achievements (
    achievement_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    points_reward INTEGER DEFAULT 0,
    unlock_item_id UUID REFERENCES marketplace_items(item_id),
    requirement_type TEXT, -- lap_time, total_laps, speed, etc.
    requirement_value JSONB, -- Flexible requirement data
    icon TEXT,
    tier INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Pilot Achievements
CREATE TABLE pilot_achievements (
    pilot_id UUID REFERENCES auth.users(id),
    achievement_id UUID REFERENCES achievements(achievement_id),
    unlocked_at TIMESTAMP DEFAULT NOW(),
    progress JSONB, -- Current progress toward achievement
    PRIMARY KEY (pilot_id, achievement_id)
);

-- Point Rules
CREATE TABLE point_rules (
    rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL, -- session_complete, lap_complete, achievement, etc.
    description TEXT,
    points INTEGER NOT NULL,
    conditions JSONB, -- Conditions for point award
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Point Transactions
CREATE TABLE point_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID REFERENCES auth.users(id),
    amount INTEGER NOT NULL, -- Positive for earn, negative for spend
    transaction_type TEXT, -- earned, spent, purchased, awarded
    reference_type TEXT, -- achievement, purchase, session, manual
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Purchases
CREATE TABLE marketplace_purchases (
    purchase_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID REFERENCES auth.users(id),
    item_id UUID REFERENCES marketplace_items(item_id),
    payment_method TEXT, -- points, usdt
    points_paid INTEGER,
    usdt_paid DECIMAL(10,2),
    purchased_at TIMESTAMP DEFAULT NOW()
);

-- USDT Transactions (extends existing wallet)
CREATE TABLE usdt_point_purchases (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID REFERENCES auth.users(id),
    usdt_amount DECIMAL(10,2) NOT NULL,
    points_received INTEGER NOT NULL,
    exchange_rate DECIMAL(10,2) DEFAULT 100, -- Points per USDT
    wallet_address TEXT,
    transaction_hash TEXT,
    status TEXT DEFAULT 'pending', -- pending, completed, failed
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

## API Endpoints

### Pilot Endpoints

```
GET    /api/rewards/points              - Get pilot's point balance
GET    /api/rewards/activity            - Get point transaction history
GET    /api/rewards/marketplace         - List marketplace items
GET    /api/rewards/marketplace/:id     - Get item details
POST   /api/rewards/purchase            - Purchase item with points/USDT
GET    /api/rewards/achievements        - List all achievements
GET    /api/rewards/achievements/mine   - Get pilot's achievements
POST   /api/rewards/points/buy          - Buy points with USDT
GET    /api/rewards/wallet              - Get wallet balance and info
```

### Admin Endpoints

```
POST   /api/admin/rewards/items         - Create marketplace item
PUT    /api/admin/rewards/items/:id     - Update marketplace item
DELETE /api/admin/rewards/items/:id     - Delete marketplace item
POST   /api/admin/rewards/achievements  - Create achievement
PUT    /api/admin/rewards/achievements/:id - Update achievement
POST   /api/admin/rewards/rules         - Create point rule
PUT    /api/admin/rewards/rules/:id     - Update point rule
POST   /api/admin/rewards/award         - Manually award points
GET    /api/admin/rewards/pilots        - List all pilots with points
```

## Point Earning Rules (Examples)

### Session-Based
- **Complete Session**: 50 points
- **First Session**: 100 points (one-time)
- **10 Sessions**: 500 points
- **100 Sessions**: 5000 points

### Performance-Based
- **Sub-30s Lap**: 100 points
- **Sub-25s Lap**: 250 points
- **Sub-20s Lap**: 500 points
- **Personal Best**: 150 points
- **Track Record**: 1000 points

### Consistency-Based
- **5 Clean Laps**: 200 points
- **10 Consistent Laps** (±1s): 400 points
- **Complete Race**: 300 points

### Participation
- **Daily Login**: 10 points
- **Event Participation**: 500 points
- **Community Challenge**: 750 points

## Integration Points

### 1. **Session Tracking**
When a pilot completes a session, the system:
1. Calculates earned points based on active rules
2. Checks for achievement progress
3. Awards points and unlocks achievements
4. Updates pilot's point balance
5. Creates transaction records

### 2. **Lap Time Recording**
After each lap:
1. Check against achievement requirements
2. Award points for milestones
3. Update achievement progress
4. Trigger notifications

### 3. **USDT Wallet**
Integration with existing wallet system:
1. Verify wallet balance
2. Process USDT → Points conversion
3. Record transaction
4. Update point balance
5. Send confirmation

### 4. **Device Management**
Link rewards to device usage:
1. Track device sessions
2. Award points per session
3. Device-specific achievements
4. Usage statistics

## Security Considerations

### Point Integrity
- Server-side validation for all point transactions
- Audit trail for all point changes
- Rate limiting on point earning
- Anti-cheat detection for lap times

### Purchase Validation
- Verify sufficient balance before purchase
- Atomic transactions (all-or-nothing)
- Stock management for limited items
- Duplicate purchase prevention

### Admin Access
- Role-based access control
- Audit logging for admin actions
- Approval workflow for large point awards
- Transaction reversal capabilities

## Implementation Phases

### Phase 1: Core System ✅
- [x] Database schema
- [x] Pilot interface HTML
- [x] Admin interface HTML
- [x] CSS styling
- [ ] JavaScript functionality
- [ ] API endpoints

### Phase 2: Point Rules
- [ ] Implement earning rules
- [ ] Session integration
- [ ] Lap time integration
- [ ] Automated point awards

### Phase 3: Marketplace
- [ ] Item management
- [ ] Purchase flow
- [ ] Inventory system
- [ ] Item delivery

### Phase 4: Achievements
- [ ] Achievement tracking
- [ ] Progress calculation
- [ ] Unlock system
- [ ] Notifications

### Phase 5: USDT Integration
- [ ] Wallet connection
- [ ] Point purchase flow
- [ ] Transaction processing
- [ ] Payment verification

### Phase 6: Advanced Features
- [ ] Leaderboards
- [ ] Seasonal rewards
- [ ] Limited-time offers
- [ ] Referral bonuses
- [ ] Gift system

## Usage Examples

### Pilot Journey

1. **New Pilot**
   - Signs up → Receives 500 welcome points
   - Completes first session → 100 bonus points
   - Total: 600 points

2. **Active Racer**
   - Completes 10 sessions → 500 points
   - Achieves sub-30s lap → 100 points
   - Unlocks "Speed Demon" achievement → 250 points
   - Total earned: 850 points

3. **Marketplace Purchase**
   - Wants new vehicle (cost: 2000 points)
   - Current balance: 1500 points
   - Buys 500 points with 5 USDT
   - Purchases vehicle
   - New balance: 0 points

### Admin Workflow

1. **Create New Item**
   - Navigate to Marketplace Items tab
   - Click "Add Item"
   - Fill in details (name, type, prices, stock)
   - Save → Item appears in marketplace

2. **Award Points**
   - Navigate to Pilot Points tab
   - Select pilot
   - Click "Award Points"
   - Enter amount and reason
   - Confirm → Points added to pilot's balance

3. **Create Achievement**
   - Navigate to Achievements tab
   - Click "Add Achievement"
   - Define requirements (e.g., "Complete 50 laps")
   - Set reward (500 points + unlock item)
   - Activate → Achievement available to pilots

## Future Enhancements

- **Social Features**: Gift points, trade items
- **Tournaments**: Special events with exclusive rewards
- **Seasons**: Rotating content and rewards
- **Prestige System**: Reset points for exclusive benefits
- **NFT Integration**: Blockchain-based unique items
- **Sponsorships**: Real-world brand partnerships
- **Streaming Integration**: Rewards for viewers
- **Mobile App**: Manage rewards on the go

## Conclusion

This rewards and marketplace system creates a comprehensive gamification layer that:
- Increases pilot engagement
- Provides monetization opportunities
- Rewards skill and dedication
- Creates progression systems
- Builds community through achievements
- Integrates seamlessly with existing infrastructure

The system is designed to be scalable, secure, and extensible for future features.

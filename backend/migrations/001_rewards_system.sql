-- FPVue Rewards System Database Migration
-- This migration creates all tables needed for the rewards and vehicle management system
-- Run this in your Supabase SQL editor

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PILOT POINTS TABLE
-- Tracks current points balance and lifetime statistics for each pilot
-- ============================================================================
CREATE TABLE IF NOT EXISTS pilot_points (
    pilot_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_points INTEGER DEFAULT 0 CHECK (current_points >= 0),
    lifetime_earned INTEGER DEFAULT 0 CHECK (lifetime_earned >= 0),
    total_spent INTEGER DEFAULT 0 CHECK (total_spent >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_pilot_points_current ON pilot_points(current_points DESC);
CREATE INDEX idx_pilot_points_lifetime ON pilot_points(lifetime_earned DESC);

-- ============================================================================
-- MARKETPLACE ITEMS TABLE
-- Stores all items available for purchase in the marketplace
-- ============================================================================
CREATE TABLE IF NOT EXISTS marketplace_items (
    item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    item_type TEXT NOT NULL CHECK (item_type IN ('vehicle', 'feature', 'cosmetic', 'boost')),
    points_price INTEGER CHECK (points_price IS NULL OR points_price > 0),
    usdt_price DECIMAL(10,2) CHECK (usdt_price IS NULL OR usdt_price > 0),
    stock INTEGER DEFAULT -1, -- -1 means unlimited
    is_active BOOLEAN DEFAULT true,
    image_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT price_check CHECK (points_price IS NOT NULL OR usdt_price IS NOT NULL)
);

CREATE INDEX idx_marketplace_items_type ON marketplace_items(item_type);
CREATE INDEX idx_marketplace_items_active ON marketplace_items(is_active) WHERE is_active = true;
CREATE INDEX idx_marketplace_items_stock ON marketplace_items(stock) WHERE stock != 0;

-- ============================================================================
-- ACHIEVEMENTS TABLE
-- Defines all achievements that pilots can unlock
-- ============================================================================
CREATE TABLE IF NOT EXISTS achievements (
    achievement_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    points_reward INTEGER DEFAULT 0 CHECK (points_reward >= 0),
    unlock_item_id UUID REFERENCES marketplace_items(item_id) ON DELETE SET NULL,
    requirement_type TEXT NOT NULL, -- 'session_count', 'lap_time', 'total_laps', etc.
    requirement_value JSONB NOT NULL, -- { "target": 100, "condition": "gte" }
    icon TEXT DEFAULT '🏆',
    tier INTEGER DEFAULT 1 CHECK (tier > 0),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_achievements_type ON achievements(requirement_type);
CREATE INDEX idx_achievements_active ON achievements(is_active) WHERE is_active = true;
CREATE INDEX idx_achievements_tier ON achievements(tier);

-- ============================================================================
-- PILOT ACHIEVEMENTS TABLE
-- Tracks which achievements each pilot has unlocked and their progress
-- ============================================================================
CREATE TABLE IF NOT EXISTS pilot_achievements (
    pilot_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_id UUID REFERENCES achievements(achievement_id) ON DELETE CASCADE,
    unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    progress JSONB DEFAULT '{"current": 0}',
    PRIMARY KEY (pilot_id, achievement_id)
);

CREATE INDEX idx_pilot_achievements_pilot ON pilot_achievements(pilot_id);
CREATE INDEX idx_pilot_achievements_unlocked ON pilot_achievements(unlocked_at);

-- ============================================================================
-- POINT RULES TABLE
-- Defines automatic point earning rules for various events
-- ============================================================================
CREATE TABLE IF NOT EXISTS point_rules (
    rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL, -- 'session_complete', 'lap_sub_30', 'achievement_unlock', etc.
    description TEXT,
    points INTEGER NOT NULL,
    conditions JSONB DEFAULT '{}', -- Additional conditions for the rule
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_point_rules_event ON point_rules(event_type);
CREATE INDEX idx_point_rules_active ON point_rules(is_active) WHERE is_active = true;

-- ============================================================================
-- POINT TRANSACTIONS TABLE
-- Audit trail for all point changes (earned and spent)
-- ============================================================================
CREATE TABLE IF NOT EXISTS point_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- Positive for earned, negative for spent
    transaction_type TEXT NOT NULL, -- 'earned', 'spent', 'admin_award', 'purchase'
    reference_type TEXT, -- 'session', 'lap', 'achievement', 'marketplace_item', 'admin'
    reference_id UUID, -- ID of the related entity
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_point_transactions_pilot ON point_transactions(pilot_id, created_at DESC);
CREATE INDEX idx_point_transactions_type ON point_transactions(transaction_type);
CREATE INDEX idx_point_transactions_reference ON point_transactions(reference_type, reference_id);

-- ============================================================================
-- MARKETPLACE PURCHASES TABLE
-- Records all marketplace item purchases
-- ============================================================================
CREATE TABLE IF NOT EXISTS marketplace_purchases (
    purchase_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    item_id UUID REFERENCES marketplace_items(item_id) ON DELETE SET NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('points', 'usdt')),
    points_paid INTEGER CHECK (points_paid IS NULL OR points_paid > 0),
    usdt_paid DECIMAL(10,2) CHECK (usdt_paid IS NULL OR usdt_paid > 0),
    purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT payment_check CHECK (
        (payment_method = 'points' AND points_paid IS NOT NULL) OR
        (payment_method = 'usdt' AND usdt_paid IS NOT NULL)
    )
);

CREATE INDEX idx_marketplace_purchases_pilot ON marketplace_purchases(pilot_id, purchased_at DESC);
CREATE INDEX idx_marketplace_purchases_item ON marketplace_purchases(item_id);

-- ============================================================================
-- USDT POINT PURCHASES TABLE
-- Tracks purchases of points using USDT
-- ============================================================================
CREATE TABLE IF NOT EXISTS usdt_point_purchases (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    usdt_amount DECIMAL(10,2) NOT NULL CHECK (usdt_amount > 0),
    points_received INTEGER NOT NULL CHECK (points_received > 0),
    exchange_rate DECIMAL(10,2) DEFAULT 100.00, -- Points per USDT
    wallet_address TEXT,
    transaction_hash TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_usdt_purchases_pilot ON usdt_point_purchases(pilot_id, created_at DESC);
CREATE INDEX idx_usdt_purchases_status ON usdt_point_purchases(status);
CREATE INDEX idx_usdt_purchases_hash ON usdt_point_purchases(transaction_hash);

-- ============================================================================
-- VEHICLES TABLE
-- Stores vehicle/car information for lap tracking integration
-- ============================================================================
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_id TEXT PRIMARY KEY,
    vehicle_name TEXT,
    vehicle_type TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_vehicles_type ON vehicles(vehicle_type);

-- ============================================================================
-- PILOT PROFILES TABLE EXTENSION
-- Add vehicle_id column to existing pilot_profiles table
-- Note: This assumes pilot_profiles table already exists from tickets system
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pilot_profiles') THEN
        -- Add vehicle_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'pilot_profiles' AND column_name = 'vehicle_id'
        ) THEN
            ALTER TABLE pilot_profiles ADD COLUMN vehicle_id TEXT REFERENCES vehicles(vehicle_id) ON DELETE SET NULL;
            CREATE INDEX idx_pilot_profiles_vehicle ON pilot_profiles(vehicle_id);
        END IF;
    ELSE
        -- Create pilot_profiles table if it doesn't exist
        CREATE TABLE pilot_profiles (
            pilot_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            display_name TEXT,
            wallet_address TEXT,
            vehicle_id TEXT REFERENCES vehicles(vehicle_id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX idx_pilot_profiles_vehicle ON pilot_profiles(vehicle_id);
    END IF;
END $$;

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
DROP TRIGGER IF EXISTS update_pilot_points_updated_at ON pilot_points;
CREATE TRIGGER update_pilot_points_updated_at
    BEFORE UPDATE ON pilot_points
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_marketplace_items_updated_at ON marketplace_items;
CREATE TRIGGER update_marketplace_items_updated_at
    BEFORE UPDATE ON marketplace_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_achievements_updated_at ON achievements;
CREATE TRIGGER update_achievements_updated_at
    BEFORE UPDATE ON achievements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_vehicles_updated_at ON vehicles;
CREATE TRIGGER update_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE pilot_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE pilot_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE usdt_point_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Pilot Points: Pilots can view their own, admins can view all
CREATE POLICY "Pilots can view own points" ON pilot_points
    FOR SELECT USING (auth.uid() = pilot_id);

CREATE POLICY "Service role can manage all points" ON pilot_points
    FOR ALL USING (auth.role() = 'service_role');

-- Marketplace Items: Everyone can view active items, admins can manage
CREATE POLICY "Anyone can view active items" ON marketplace_items
    FOR SELECT USING (is_active = true);

CREATE POLICY "Service role can manage items" ON marketplace_items
    FOR ALL USING (auth.role() = 'service_role');

-- Achievements: Everyone can view active achievements
CREATE POLICY "Anyone can view active achievements" ON achievements
    FOR SELECT USING (is_active = true);

CREATE POLICY "Service role can manage achievements" ON achievements
    FOR ALL USING (auth.role() = 'service_role');

-- Pilot Achievements: Pilots can view their own
CREATE POLICY "Pilots can view own achievements" ON pilot_achievements
    FOR SELECT USING (auth.uid() = pilot_id);

CREATE POLICY "Service role can manage pilot achievements" ON pilot_achievements
    FOR ALL USING (auth.role() = 'service_role');

-- Point Rules: Everyone can view active rules
CREATE POLICY "Anyone can view active rules" ON point_rules
    FOR SELECT USING (is_active = true);

CREATE POLICY "Service role can manage rules" ON point_rules
    FOR ALL USING (auth.role() = 'service_role');

-- Point Transactions: Pilots can view their own
CREATE POLICY "Pilots can view own transactions" ON point_transactions
    FOR SELECT USING (auth.uid() = pilot_id);

CREATE POLICY "Service role can manage transactions" ON point_transactions
    FOR ALL USING (auth.role() = 'service_role');

-- Marketplace Purchases: Pilots can view their own
CREATE POLICY "Pilots can view own purchases" ON marketplace_purchases
    FOR SELECT USING (auth.uid() = pilot_id);

CREATE POLICY "Service role can manage purchases" ON marketplace_purchases
    FOR ALL USING (auth.role() = 'service_role');

-- USDT Purchases: Pilots can view their own
CREATE POLICY "Pilots can view own USDT purchases" ON usdt_point_purchases
    FOR SELECT USING (auth.uid() = pilot_id);

CREATE POLICY "Service role can manage USDT purchases" ON usdt_point_purchases
    FOR ALL USING (auth.role() = 'service_role');

-- Vehicles: Everyone can view
CREATE POLICY "Anyone can view vehicles" ON vehicles
    FOR SELECT USING (true);

CREATE POLICY "Service role can manage vehicles" ON vehicles
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- SEED DATA - Default Point Rules
-- ============================================================================
INSERT INTO point_rules (event_type, description, points, is_active) VALUES
    ('session_complete', 'Complete a racing session', 50, true),
    ('lap_sub_30', 'Complete a lap in under 30 seconds', 100, true),
    ('lap_sub_25', 'Complete a lap in under 25 seconds', 200, true),
    ('lap_sub_20', 'Complete a lap in under 20 seconds', 500, true),
    ('first_session', 'Complete your first session', 100, true),
    ('daily_login', 'Log in daily', 10, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED DATA - Sample Achievements
-- ============================================================================
INSERT INTO achievements (name, description, points_reward, requirement_type, requirement_value, icon, tier) VALUES
    ('First Flight', 'Complete your first racing session', 100, 'session_count', '{"target": 1}', '🎯', 1),
    ('Speed Demon', 'Complete a lap in under 30 seconds', 250, 'lap_time', '{"target": 30000, "condition": "lt"}', '⚡', 2),
    ('Marathon Racer', 'Complete 50 racing sessions', 500, 'session_count', '{"target": 50}', '🏃', 3),
    ('Lap Master', 'Complete 100 laps', 300, 'total_laps', '{"target": 100}', '🔄', 2),
    ('Consistency King', 'Complete 10 laps with times within 2 seconds', 400, 'consistency', '{"target": 10, "variance": 2000}', '👑', 3)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- SEED DATA - Sample Marketplace Items
-- ============================================================================
INSERT INTO marketplace_items (name, description, item_type, points_price, usdt_price, stock) VALUES
    ('Velocity Racer', 'High-performance racing drone with enhanced speed', 'vehicle', 5000, 50.00, 10),
    ('Precision Handler', 'Balanced drone for technical courses', 'vehicle', 4000, 40.00, 15),
    ('Advanced Telemetry', 'Real-time performance metrics and analytics', 'feature', 2000, 20.00, -1),
    ('Custom HUD Layout', 'Personalize your heads-up display', 'feature', 1500, 15.00, -1),
    ('Neon Trail Effect', 'Leave a colorful trail behind your drone', 'cosmetic', 1000, 10.00, -1),
    ('Chrome Skin', 'Shiny metallic drone appearance', 'cosmetic', 800, 8.00, -1),
    ('XP Boost 2x', '2x experience points for 24 hours', 'boost', 1200, 12.00, -1),
    ('Points Multiplier', '1.5x points for 1 hour', 'boost', 500, 5.00, -1)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
COMMENT ON TABLE pilot_points IS 'Tracks point balances and statistics for each pilot';
COMMENT ON TABLE marketplace_items IS 'Items available for purchase in the rewards marketplace';
COMMENT ON TABLE achievements IS 'Achievement definitions with requirements and rewards';
COMMENT ON TABLE pilot_achievements IS 'Tracks pilot progress and unlocked achievements';
COMMENT ON TABLE point_rules IS 'Automatic point earning rules for various events';
COMMENT ON TABLE point_transactions IS 'Audit trail for all point transactions';
COMMENT ON TABLE marketplace_purchases IS 'Record of all marketplace purchases';
COMMENT ON TABLE usdt_point_purchases IS 'USDT to points conversion transactions';
COMMENT ON TABLE vehicles IS 'Vehicle/car registry for lap tracking integration';

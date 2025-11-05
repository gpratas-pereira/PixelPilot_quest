-- FPVue Rewards System Database Migration
-- Create marketplace_items table for storing items created in admin interface

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create marketplace_items table
CREATE TABLE IF NOT EXISTS marketplace_items (
    item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    item_type VARCHAR(50) NOT NULL CHECK (item_type IN ('vehicle', 'feature', 'cosmetic', 'boost', 'ticket')),
    points_price INTEGER,
    usdt_price DECIMAL(10,2),
    stock INTEGER DEFAULT -1, -- -1 means unlimited
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create pilot_points table
CREATE TABLE IF NOT EXISTS pilot_points (
    pilot_id UUID PRIMARY KEY,
    current_points INTEGER DEFAULT 0,
    lifetime_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create point_transactions table
CREATE TABLE IF NOT EXISTS point_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID NOT NULL REFERENCES pilot_points(pilot_id),
    amount INTEGER NOT NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('earned', 'spent')),
    reference_type VARCHAR(50), -- e.g., 'marketplace_item', 'achievement', 'admin_award'
    reference_id UUID,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create marketplace_purchases table
CREATE TABLE IF NOT EXISTS marketplace_purchases (
    purchase_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID NOT NULL REFERENCES pilot_points(pilot_id),
    item_id UUID NOT NULL REFERENCES marketplace_items(item_id),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('points', 'usdt')),
    points_paid INTEGER,
    usdt_paid DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create achievements table
CREATE TABLE IF NOT EXISTS achievements (
    achievement_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(10) DEFAULT '🏆',
    points_reward INTEGER DEFAULT 0,
    unlock_item_id UUID REFERENCES marketplace_items(item_id),
    requirement_type VARCHAR(50) NOT NULL,
    requirement_value JSONB NOT NULL,
    tier INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create pilot_achievements table
CREATE TABLE IF NOT EXISTS pilot_achievements (
    pilot_id UUID NOT NULL REFERENCES pilot_points(pilot_id),
    achievement_id UUID NOT NULL REFERENCES achievements(achievement_id),
    progress_current INTEGER DEFAULT 0,
    unlocked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (pilot_id, achievement_id)
);

-- Create point_rules table
CREATE TABLE IF NOT EXISTS point_rules (
    rule_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    description TEXT,
    points INTEGER NOT NULL,
    conditions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create usdt_point_purchases table
CREATE TABLE IF NOT EXISTS usdt_point_purchases (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pilot_id UUID NOT NULL REFERENCES pilot_points(pilot_id),
    usdt_amount DECIMAL(10,2) NOT NULL,
    points_received INTEGER NOT NULL,
    exchange_rate DECIMAL(5,2) NOT NULL,
    wallet_address VARCHAR(255),
    transaction_hash VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_marketplace_items_type ON marketplace_items(item_type);
CREATE INDEX IF NOT EXISTS idx_marketplace_items_active ON marketplace_items(is_active);
CREATE INDEX IF NOT EXISTS idx_point_transactions_pilot ON point_transactions(pilot_id);
CREATE INDEX IF NOT EXISTS idx_point_transactions_type ON point_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_pilot_achievements_pilot ON pilot_achievements(pilot_id);
CREATE INDEX IF NOT EXISTS idx_pilot_achievements_unlocked ON pilot_achievements(unlocked_at);
CREATE INDEX IF NOT EXISTS idx_usdt_purchases_status ON usdt_point_purchases(status);

-- Insert some sample marketplace items for testing
INSERT INTO marketplace_items (name, description, item_type, points_price, usdt_price, stock, is_active) VALUES
('Premium Racing Helmet', 'High-quality racing helmet with improved aerodynamics', 'cosmetic', 500, 5.00, 100, true),
('Track Day Pass', 'Full day access to premium track facilities', 'feature', 1000, 10.00, 50, true),
('Performance Boost', 'Temporary speed enhancement for competitive racing', 'boost', 200, 2.00, -1, true),
('Custom Livery Set', 'Unique paint scheme for your racing vehicle', 'cosmetic', 750, 7.50, 25, true)
ON CONFLICT DO NOTHING;

-- Insert some sample achievements
INSERT INTO achievements (name, description, points_reward, requirement_type, requirement_value, tier) VALUES
('First Victory', 'Win your first race', 100, 'race_wins', '{"target": 1}', 1),
('Speed Demon', 'Achieve a top speed of 200+ km/h', 250, 'max_speed', '{"target": 200}', 2),
('Consistent Performer', 'Complete 10 races without DNF', 500, 'races_completed', '{"target": 10}', 2),
('Track Master', 'Set 5 fastest laps on different tracks', 1000, 'fastest_laps', '{"target": 5}', 3)
ON CONFLICT DO NOTHING;

-- Insert some sample point rules
INSERT INTO point_rules (event_type, description, points, is_active) VALUES
('session_complete', 'Complete a racing session', 50, true),
('lap_complete', 'Complete a lap under 2 minutes', 25, true),
('race_win', 'Win a race', 100, true),
('new_personal_best', 'Set a new personal best lap time', 75, true)
ON CONFLICT DO NOTHING;

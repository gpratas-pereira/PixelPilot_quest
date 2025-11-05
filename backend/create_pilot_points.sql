-- Fix missing pilot_points table
CREATE TABLE IF NOT EXISTS pilot_points (
    pilot_id TEXT PRIMARY KEY,
    current_points INTEGER DEFAULT 0,
    lifetime_earned INTEGER DEFAULT 0,
    total_spent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pilot_id) REFERENCES pilots(pilot_id)
);

-- Create point_transactions table if it doesn't exist
CREATE TABLE IF NOT EXISTS point_transactions (
    transaction_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    pilot_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    reference_type TEXT,
    reference_id TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pilot_id) REFERENCES pilots(pilot_id)
);

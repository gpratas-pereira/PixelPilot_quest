require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const { BscPaymentVerifier } = require('./payments/bscVerifier');
const path = require('path');

// Import rewards routes
const { router: rewardsRouter, awardPoints } = require('./routes/rewards');
const rewardsAdminRouter = require('./routes/rewards-admin');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PAYMENT_USDT_ADDRESS = process.env.PAYMENT_USDT_ADDRESS || null;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️  Supabase service credentials are not fully configured. Authentication-protected routes will be unavailable.');
}

const DEFAULT_PAYMENT_CURRENCY = 'USDT';

// Function to fetch marketplace items from Supabase
async function getMarketplaceItems() {
    if (!supabaseAdmin) {
        console.warn('⚠️  Supabase not configured, returning empty marketplace items');
        return [];
    }
    
    try {
        const { data, error } = await supabaseAdmin
            .from('marketplace_items')
            .select('*')
            .eq('is_active', true)
            .or('is_locked.is.null,is_locked.eq.false') // Only get items where is_locked is null or false
            .order('points_price', { ascending: true });
            
        if (error) {
            console.error('Error fetching marketplace items:', error);
            return [];
        }
        
        // Transform to match the old MINUTE_PACKAGES format for backward compatibility
        return data.map(item => ({
            id: item.item_id,
            label: item.name,
            minutes: item.metadata?.minutes || 0,
            description: item.description,
            points_price: item.points_price,
            usdt_price: item.usdt_price,
            stock: item.stock
        }));
    } catch (err) {
        console.error('Failed to fetch marketplace items:', err);
        return [];
    }
}
const BSC_RPC_URL = process.env.BSC_RPC_URL;
const BSC_USDT_CONTRACT = (process.env.BSC_USDT_CONTRACT || '').toLowerCase();
const BSC_MIN_CONFIRMATIONS = Number.parseInt(process.env.BSC_MIN_CONFIRMATIONS || '12', 10) || 12;
const BSC_USDT_DECIMALS = Number.parseInt(process.env.BSC_USDT_DECIMALS || '18', 10) || 18;
const BSC_POLL_INTERVAL_MS = Number.parseInt(process.env.BSC_POLL_INTERVAL_MS || '60000', 10) || 60000;

const app = express();
const PORT = process.env.PORT || 3000;

const START_LINE_INTERVAL_MS = 1000;
const START_LINE_LED_COUNT = 5;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Security headers to prevent extension interference
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

app.use('/patternfly', express.static(path.join(__dirname, 'node_modules/@patternfly/patternfly')));
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./devices.db');

// Inject Supabase admin client and admin emails into requests
app.use((req, res, next) => {
    req.supabaseAdmin = supabaseAdmin;
    req.adminEmails = ADMIN_EMAILS;
    req.db = db; // Add SQLite database connection
    next();
});

// Mount rewards routes
app.use(
    '/api/rewards',
    authenticateSupabase,
    requirePilot,
    rewardsRouter
);
app.use(
    '/api/admin/rewards',
    authenticateSupabase,
    requireGroup('rewards_admin', 'payments_admin'),
    rewardsAdminRouter
);

const requireAdmin = requireGroup('admin');
const requireOps = requireGroup('ops');
const requirePitlane = requireGroup('pitlane');
const requirePaymentsAdmin = requireGroup('payments_admin');
const requirePilot = requireGroup('pilot');

app.get('/api/session', authenticateSupabase, (req, res) => {
    res.json({
        user: req.supabaseUser,
        groups: Array.isArray(req.userGroups) ? req.userGroups : []
    });
});

// Initialize database
db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');

    db.run(`CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.log('❌ Error creating system_settings table:', err.message);
        }
    });

    if (PAYMENT_USDT_ADDRESS) {
        db.run(
            `INSERT INTO system_settings (key, value, updated_at)
             VALUES ('payment.usdt_wallet', ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
            [PAYMENT_USDT_ADDRESS],
            (err) => {
                if (err) {
                    console.log('⚠️  Failed to seed payment wallet from env:', err.message);
                }
            }
        );
    }

    // Create pilot_points table
    db.run(`CREATE TABLE IF NOT EXISTS pilot_points (
        pilot_id TEXT PRIMARY KEY,
        current_points INTEGER DEFAULT 0,
        lifetime_earned INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pilot_id) REFERENCES pilots(pilot_id)
    )`, (err) => {
        if (err) {
            console.log('❌ Error creating pilot_points table:', err.message);
        } else {
            console.log('✅ Pilot points table ready');
        }
    });


    // Ensure pilots table includes vehicle_id column for pilot assignments
    db.all("PRAGMA table_info(pilots)", (err, columns) => {
        if (err) {
            console.log('Pilots schema inspection failed:', err.message);
            return;
        }

        const hasVehicleId = columns.some(col => col.name === 'vehicle_id');
        if (!hasVehicleId) {
            console.log('Adding vehicle_id column to pilots table�');
            db.run("ALTER TABLE pilots ADD COLUMN vehicle_id TEXT", alterErr => {
                if (alterErr) {
                    console.log('Failed to add vehicle_id column to pilots table:', alterErr.message);
                } else {
                    console.log('Added vehicle_id column to pilots table');
                }
            });
        }
    });

    // First check if table exists with old schema
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'", (err, row) => {
        if (row) {
            // Table exists - check if it has device_id column
            db.get("PRAGMA table_info(devices)", (err, info) => {
                db.all("PRAGMA table_info(devices)", (err, columns) => {
                    const hasDeviceId = columns.some(col => col.name === 'device_id');
                    const hasSessionDuration = columns.some(col => col.name === 'session_duration');
                    const hasSessionStartTime = columns.some(col => col.name === 'session_start_time');
                    const hasSessionRemaining = columns.some(col => col.name === 'session_remaining');
                    const hasBatteryLevel = columns.some(col => col.name === 'battery_level');
                    const hasBatteryCharging = columns.some(col => col.name === 'battery_charging');
                    const hasDisplayMode = columns.some(col => col.name === 'display_mode');
                    const hasCurrentPilotId = columns.some(col => col.name === 'current_pilot_id');
                    const hasCurrentPilotName = columns.some(col => col.name === 'current_pilot_name');
                    const hasCurrentTicketId = columns.some(col => col.name === 'current_ticket_id');
                    const hasCurrentSessionId = columns.some(col => col.name === 'current_session_id');
                    
                    let migrationNeeded = false;
                    
                    if (!hasDeviceId) {
                        console.log('🔄 Migrating database to support device identifiers...');
                        migrationNeeded = true;
                        // Add device_id column
                        db.run(`ALTER TABLE devices ADD COLUMN device_id TEXT`, (err) => {
                            if (err) {
                                console.log('Migration error:', err.message);
                                return;
                            }
                            // Migrate existing MAC-only records
                            db.run(`UPDATE devices SET device_id = 'MAC:' || mac_address WHERE device_id IS NULL AND mac_address IS NOT NULL`, (err) => {
                                if (err) {
                                    console.log('Migration update error:', err.message);
                                } else {
                                    console.log('✅ Device ID migration completed');
                                }
                            });
                        });
                    }
                    
                    if (!hasSessionDuration) {
                        console.log('🔄 Adding session duration support...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN session_duration INTEGER DEFAULT 1800`, (err) => {
                            if (err) {
                                console.log('Session duration migration error:', err.message);
                            } else {
                                console.log('✅ Session duration column added');
                            }
                        });
                    }
                    
                    if (!hasSessionStartTime) {
                        console.log('🔄 Adding session start time support...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN session_start_time DATETIME`, (err) => {
                            if (err) {
                                console.log('Session start time migration error:', err.message);
                            } else {
                                console.log('✅ Session start time column added');
                            }
                        });
                    }
                    
                    if (!hasSessionRemaining) {
                        console.log('🔄 Adding session remaining time support...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN session_remaining INTEGER DEFAULT 1800`, (err) => {
                            if (err) {
                                console.log('Session remaining migration error:', err.message);
                            } else {
                                console.log('✅ Session remaining column added');
                            }
                        });
                    }
                    
                    if (!hasBatteryLevel) {
                        console.log('🔄 Adding battery level support...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN battery_level INTEGER DEFAULT -1`, (err) => {
                            if (err) {
                                console.log('Battery level migration error:', err.message);
                            } else {
                                console.log('✅ Battery level column added');
                            }
                        });
                    }
                    
                    if (!hasBatteryCharging) {
                        console.log('🔄 Adding battery charging status support...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN battery_charging BOOLEAN DEFAULT 0`, (err) => {
                            if (err) {
                                console.log('Battery charging migration error:', err.message);
                            } else {
                                console.log('✅ Battery charging column added');
                            }
                        });
                    }
                    
                    if (!hasDisplayMode) {
                        console.log('🔄 Adding display mode support...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN display_mode TEXT DEFAULT 'curved'`, (err) => {
                            if (err) {
                                console.log('Display mode migration error:', err.message);
                            } else {
                                console.log('✅ Display mode column added');
                            }
                        });
                    }

                    if (!hasCurrentPilotId) {
                        console.log('🔄 Adding current pilot tracking to devices...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN current_pilot_id TEXT`, (err) => {
                            if (err) {
                                console.log('Current pilot ID migration error:', err.message);
                            } else {
                                console.log('✅ Current pilot ID column added');
                            }
                        });
                    }

                    if (!hasCurrentPilotName) {
                        console.log('🔄 Adding current pilot name to devices...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN current_pilot_name TEXT`, (err) => {
                            if (err) {
                                console.log('Current pilot name migration error:', err.message);
                            } else {
                                console.log('✅ Current pilot name column added');
                            }
                        });
                    }

                    if (!hasCurrentTicketId) {
                        console.log('🔄 Adding current ticket tracking to devices...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN current_ticket_id TEXT`, (err) => {
                            if (err) {
                                console.log('Current ticket ID migration error:', err.message);
                            } else {
                                console.log('✅ Current ticket ID column added');
                            }
                        });
                    }

                    if (!hasCurrentSessionId) {
                        console.log('🔄 Adding current session tracking to devices...');
                        migrationNeeded = true;
                        db.run(`ALTER TABLE devices ADD COLUMN current_session_id TEXT`, (err) => {
                            if (err) {
                                console.log('Current session ID migration error:', err.message);
                            } else {
                                console.log('✅ Current session ID column added');
                            }
                        });
                    }
                    
                    if (!migrationNeeded) {
                        console.log('✅ Database schema is up to date');
                    }
                });
            });
        } else {
            // Create new table with device_id support
            db.run(`CREATE TABLE devices (
                id TEXT PRIMARY KEY,
                device_id TEXT UNIQUE,
                mac_address TEXT,
                device_name TEXT,
                wifi_channel INTEGER DEFAULT 173,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'offline',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                session_duration INTEGER DEFAULT 1800,
                session_start_time DATETIME,
                session_remaining INTEGER DEFAULT 1800,
                battery_level INTEGER DEFAULT -1,
                battery_charging BOOLEAN DEFAULT 0,
                display_mode TEXT DEFAULT 'curved',
                current_pilot_id TEXT,
                current_pilot_name TEXT,
                current_ticket_id TEXT,
                current_session_id TEXT
            )`, (err) => {
                if (err) {
                    console.log('❌ Error creating devices table:', err.message);
                } else {
                    console.log('✅ Created devices table with device_id support');
                }
            });
        }
    });
    
    // Ensure all pilots have pilot_points records
    db.run(`
        INSERT OR IGNORE INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent)
        SELECT pilot_id, 0, 0, 0 FROM pilots
    `, (err) => {
        if (err) {
            console.log('❌ Error ensuring pilot points records:', err.message);
        } else {
            console.log('✅ Pilot points records initialized');
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY,
        pilot_id TEXT NOT NULL,
        ticket_type TEXT DEFAULT 'race-pass',
        payment_currency TEXT DEFAULT 'USDT',
        payment_amount REAL DEFAULT 0,
        payment_reference TEXT,
        payment_status TEXT DEFAULT 'pending',
        event_name TEXT,
        event_date DATETIME,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        package_id TEXT,
        package_label TEXT,
        package_minutes INTEGER DEFAULT 0,
        minutes_consumed INTEGER DEFAULT 0,
        redeemed BOOLEAN DEFAULT 0,
        archived BOOLEAN DEFAULT 0,
        verification_attempts INTEGER DEFAULT 0,
        last_verification_at DATETIME,
        verification_error TEXT,
        FOREIGN KEY (pilot_id) REFERENCES pilots(pilot_id)
    )`, (err) => {
        if (err) {
            console.log('❌ Error creating tickets table:', err.message);
        } else {
            console.log('✅ Tickets table ready');
        }
    });

    db.all("PRAGMA table_info(tickets)", (err, columns) => {
        if (err) {
            console.log('Tickets schema inspection failed:', err.message);
            return;
        }

        const hasUpdatedAt = columns.some(col => col.name === 'updated_at');
        const hasPackageId = columns.some(col => col.name === 'package_id');
        const hasPackageLabel = columns.some(col => col.name === 'package_label');
        const hasPackageMinutes = columns.some(col => col.name === 'package_minutes');
        const hasMinutesConsumed = columns.some(col => col.name === 'minutes_consumed');
        const hasRedeemed = columns.some(col => col.name === 'redeemed');
        const hasArchived = columns.some(col => col.name === 'archived');
        const hasVerificationAttempts = columns.some(col => col.name === 'verification_attempts');
        const hasVerificationTimestamp = columns.some(col => col.name === 'last_verification_at');
        const hasVerificationError = columns.some(col => col.name === 'verification_error');
        if (!hasUpdatedAt) {
            db.run(`ALTER TABLE tickets ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets updated_at migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.updated_at column added');
                }
            });
        }

        if (!hasPackageId) {
            db.run(`ALTER TABLE tickets ADD COLUMN package_id TEXT`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets package_id migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.package_id column added');
                }
            });
        }

        if (!hasPackageLabel) {
            db.run(`ALTER TABLE tickets ADD COLUMN package_label TEXT`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets package_label migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.package_label column added');
                }
            });
        }

        if (!hasPackageMinutes) {
            db.run(`ALTER TABLE tickets ADD COLUMN package_minutes INTEGER DEFAULT 0`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets package_minutes migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.package_minutes column added');
                }
            });
        }

        if (!hasMinutesConsumed) {
            db.run(`ALTER TABLE tickets ADD COLUMN minutes_consumed INTEGER DEFAULT 0`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets minutes_consumed migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.minutes_consumed column added');
                }
            });
        }

        if (!hasRedeemed) {
            db.run(`ALTER TABLE tickets ADD COLUMN redeemed BOOLEAN DEFAULT 0`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets redeemed migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.redeemed column added');
                }
            });
        }

        if (!hasArchived) {
            db.run(`ALTER TABLE tickets ADD COLUMN archived BOOLEAN DEFAULT 0`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets archived migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.archived column added');
                }
            });
        }

        if (!hasVerificationAttempts) {
            db.run(`ALTER TABLE tickets ADD COLUMN verification_attempts INTEGER DEFAULT 0`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets verification_attempts migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.verification_attempts column added');
                }
            });
        }

        if (!hasVerificationTimestamp) {
            db.run(`ALTER TABLE tickets ADD COLUMN last_verification_at DATETIME`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets last_verification_at migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.last_verification_at column added');
                }
            });
        }

        if (!hasVerificationError) {
            db.run(`ALTER TABLE tickets ADD COLUMN verification_error TEXT`, (alterErr) => {
                if (alterErr) {
                    console.log('Tickets verification_error migration error:', alterErr.message);
                } else {
                    console.log('✅ tickets.verification_error column added');
                }
            });
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS pit_lane_registrations (
        registration_id TEXT PRIMARY KEY,
        pilot_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        ticket_id TEXT,
        pilot_name TEXT,
        check_in_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'active',
        notes TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        session_id TEXT,
        allocated_minutes INTEGER DEFAULT 0,
        FOREIGN KEY (pilot_id) REFERENCES pilots(pilot_id),
        FOREIGN KEY (device_id) REFERENCES devices(device_id),
        FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id),
        FOREIGN KEY (session_id) REFERENCES lap_sessions(session_id)
    )`, (err) => {
        if (err) {
            console.log('❌ Error creating pit_lane_registrations table:', err.message);
        } else {
            console.log('✅ Pit lane registrations table ready');
        }
    });

    db.all("PRAGMA table_info(pit_lane_registrations)", (err, columns) => {
        if (err) {
            console.log('Pit lane registration schema inspection failed:', err.message);
            return;
        }

        const hasUpdatedAt = columns.some(col => col.name === 'updated_at');
        const hasSessionId = columns.some(col => col.name === 'session_id');
        const hasAllocatedMinutes = columns.some(col => col.name === 'allocated_minutes');
        if (!hasUpdatedAt) {
            db.run(`ALTER TABLE pit_lane_registrations ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (alterErr) => {
                if (alterErr) {
                    console.log('Pit lane updated_at migration error:', alterErr.message);
                } else {
                    console.log('✅ pit_lane_registrations.updated_at column added');
                }
            });
        }

        if (!hasSessionId) {
            db.run(`ALTER TABLE pit_lane_registrations ADD COLUMN session_id TEXT`, (alterErr) => {
                if (alterErr) {
                    console.log('Pit lane session_id migration error:', alterErr.message);
                } else {
                    console.log('✅ pit_lane_registrations.session_id column added');
                }
            });
        }

        if (!hasAllocatedMinutes) {
            db.run(`ALTER TABLE pit_lane_registrations ADD COLUMN allocated_minutes INTEGER DEFAULT 0`, (alterErr) => {
                if (alterErr) {
                    console.log('Pit lane allocated_minutes migration error:', alterErr.message);
                } else {
                    console.log('✅ pit_lane_registrations.allocated_minutes column added');
                }
            });
        }

        const migrationNeeded = !hasUpdatedAt || !hasSessionId || !hasAllocatedMinutes;
        if (!migrationNeeded) {
            console.log('✅ Database schema is up to date');
        }
    });

    db.run("INSERT OR IGNORE INTO start_line_state (id, status, step_interval_ms) VALUES (1, 'idle', 1000)", (err) => {
        if (err) {
            console.log('Error initializing start line state:', err.message);
        }
    });
});

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

function dbRun(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ changes: this.changes, lastID: this.lastID });
            }
        });
    });
}

async function getSystemSetting(key, fallback = null) {
    try {
        const row = await dbGet('SELECT value FROM system_settings WHERE key = ?', [key]);
        if (!row || row.value === undefined || row.value === null) {
            return fallback;
        }
        return row.value;
    } catch (err) {
        console.error(`Failed to read setting ${key}:`, err.message);
        return fallback;
    }
}

async function setSystemSetting(key, value) {
    try {
        const normalized = value !== undefined && value !== null ? String(value).trim() : null;
        await dbRun(
            `INSERT INTO system_settings (key, value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
            [key, normalized]
        );
        return normalized;
    } catch (err) {
        console.error(`Failed to store setting ${key}:`, err.message);
        throw err;
    }
}

let bscPaymentVerifier = null;

function parseTimestamp(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
        const date = new Date(value * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === 'string') {
        if (!value.length) {
            return null;
        }

        // Try ISO first
        let attempt = value;
        let date = new Date(attempt);
        if (!Number.isNaN(date.getTime())) {
            return date;
        }

        // Convert "YYYY-MM-DD HH:MM:SS" to ISO
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
            attempt = value.replace(' ', 'T');
            date = new Date(attempt + 'Z');
            if (!Number.isNaN(date.getTime())) {
                return date;
            }
        }

        // Ensure trailing Z for UTC if missing
        if (!/[zZ]$/.test(attempt)) {
            attempt += 'Z';
            date = new Date(attempt);
            if (!Number.isNaN(date.getTime())) {
                return date;
            }
        }
    }

    return null;
}

function calculateRemainingSeconds(device) {
    const duration = Number(device.session_duration || 0);
    const storedRemaining = Number(device.session_remaining || 0);
    const startTime = parseTimestamp(device.session_start_time);

    if (!startTime) {
        return storedRemaining > 0 ? storedRemaining : duration;
    }

    if (!duration) {
        return 0;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000));
    return Math.max(0, duration - elapsedSeconds);
}

function mapStartLineRow(row) {
    if (!row) {
        return {
            status: 'idle',
            armed_at: null,
            countdown_started_at: null,
            step_interval_ms: START_LINE_INTERVAL_MS,
            led_count: START_LINE_LED_COUNT,
            updated_at: null,
            server_time_ms: Date.now()
        };
    }

    return {
        status: row.status || 'idle',
        armed_at: row.armed_at !== null ? Number(row.armed_at) : null,
        countdown_started_at: row.countdown_started_at !== null ? Number(row.countdown_started_at) : null,
        step_interval_ms: row.step_interval_ms || START_LINE_INTERVAL_MS,
        led_count: START_LINE_LED_COUNT,
        updated_at: row.updated_at || null,
        server_time_ms: Date.now()
    };
}

function fetchStartLineState(callback) {
    db.get('SELECT status, armed_at, countdown_started_at, step_interval_ms, updated_at FROM start_line_state WHERE id = 1', (err, row) => {
        if (err) {
            callback(err);
            return;
        }

        const state = mapStartLineRow(row);
        const now = Date.now();

        if (state.status === 'countdown' && state.countdown_started_at !== null) {
            const interval = state.step_interval_ms || START_LINE_INTERVAL_MS;
            const ledCount = state.led_count || START_LINE_LED_COUNT;
            const totalDuration = interval * ledCount;
            if (totalDuration > 0 && now - state.countdown_started_at >= totalDuration) {
                updateStartLineState({ status: 'go' }, (updateErr) => {
                    if (updateErr) {
                        callback(updateErr);
                        return;
                    }
                    fetchStartLineState(callback);
                });
                return;
            }
        }

        state.server_time_ms = now;
        callback(null, state);
    });
}

function updateStartLineState(fields, callback) {
    const columns = [];
    const values = [];

    if (fields.status !== undefined) {
        columns.push('status = ?');
        values.push(fields.status);
    }
    if (fields.armed_at !== undefined) {
        columns.push('armed_at = ?');
        values.push(fields.armed_at);
    }
    if (fields.countdown_started_at !== undefined) {
        columns.push('countdown_started_at = ?');
        values.push(fields.countdown_started_at);
    }
    if (fields.step_interval_ms !== undefined) {
        columns.push('step_interval_ms = ?');
        values.push(fields.step_interval_ms);
    }

    if (columns.length === 0) {
        if (callback) {
            callback(null);
        }
        return;
    }

    columns.push('updated_at = CURRENT_TIMESTAMP');
    const query = 'UPDATE start_line_state SET ' + columns.join(', ') + ' WHERE id = 1';

    db.run(query, values, function(err) {
        if (callback) {
            if (err) {
                callback(err);
            } else {
                callback(null);
            }
        }
    });
}


function parseCookies(cookieHeader = '') {
    if (!cookieHeader || typeof cookieHeader !== 'string') {
        return {};
    }

    return cookieHeader.split(';').reduce((allCookies, rawCookie) => {
        const [name, ...rest] = rawCookie.split('=');
        if (!name) {
            return allCookies;
        }
        const trimmedName = name.trim();
        if (!trimmedName) {
            return allCookies;
        }
        const value = rest.join('=').trim();
        allCookies[trimmedName] = decodeURIComponent(value);
        return allCookies;
    }, {});
}

function extractTokenFromCookieValue(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const tryObjectExtraction = (payload) => {
        if (!payload) {
            return null;
        }
        if (typeof payload === 'string') {
            return payload;
        }
        if (Array.isArray(payload)) {
            for (const item of payload) {
                const token = tryObjectExtraction(item);
                if (token) {
                    return token;
                }
            }
            return null;
        }
        if (typeof payload === 'object') {
            if (typeof payload.access_token === 'string') {
                return payload.access_token;
            }
            if (payload.currentSession && typeof payload.currentSession.access_token === 'string') {
                return payload.currentSession.access_token;
            }
            if (payload.session && typeof payload.session.access_token === 'string') {
                return payload.session.access_token;
            }
            return null;
        }
        return null;
    };

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            const extracted = tryObjectExtraction(parsed);
            if (extracted) {
                return extracted;
            }
        } catch (err) {
            // fall through to raw value
        }
    }

    return trimmed;
}

function extractSupabaseToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ')) {
        return authHeader.trim().substring('bearer '.length).trim();
    }

    const headerCandidates = [
        'x-supabase-auth',
        'x-supabase-access-token',
        'supabase-access-token'
    ];

    for (const headerName of headerCandidates) {
        const value = req.headers[headerName];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    const cookies = parseCookies(req.headers.cookie);
    const cookieCandidates = [
        cookies['sb-access-token'],
        cookies['sb_access_token'],
        cookies['supabase-auth-token'],
        cookies['sb-session'],
        cookies['sb:token']
    ];
    for (const candidate of cookieCandidates) {
        const tokenFromCookie = extractTokenFromCookieValue(candidate);
        if (tokenFromCookie) {
            return tokenFromCookie;
        }
    }

    if (req.query && req.query.access_token) {
        const queryToken = String(req.query.access_token).trim();
        if (queryToken) {
            return queryToken;
        }
    }

    return null;
}

async function authenticateSupabase(req, res, next) {
    if (!supabaseAdmin) {
        res.status(503).json({ error: 'Supabase authentication is not configured on the server' });
        return;
    }

    const token = extractSupabaseToken(req);

    if (!token) {
        res.status(401).json({
            error: 'Authorization token missing',
            message: 'Provide a Supabase access token via Authorization header, sb-access-token cookie, or access_token query parameter.'
        });
        return;
    }

    try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !data || !data.user) {
            res.status(401).json({ error: 'Invalid Supabase session' });
            return;
        }

        const supabaseUser = data.user;

        let groups = [];
        const userId = supabaseUser?.id;
        if (userId) {
            const { data: groupRows, error: groupError } = await supabaseAdmin
                .from('user_groups')
                .select('group_name')
                .eq('user_id', userId);

            if (groupError) {
                console.error('Failed to load user groups:', groupError.message);
                res.status(500).json({ error: 'Failed to load user groups' });
                return;
            }

            groups = Array.from(
                new Set(
                    (groupRows || [])
                        .map(row => String(row.group_name || '').trim().toLowerCase())
                        .filter(Boolean)
                )
            );
        }

        const email = typeof supabaseUser?.email === 'string'
            ? supabaseUser.email.trim().toLowerCase()
            : null;

        if (email) {
            req.supabaseEmail = email;
        }

        if (email && ADMIN_EMAILS.includes(email)) {
            const defaultAdminGroups = ['admin', 'rewards_admin', 'payments_admin', 'ops', 'pitlane'];
            groups = Array.from(new Set([...groups, ...defaultAdminGroups]));
        }

        req.supabaseUser = supabaseUser;
        req.supabaseToken = token;
        req.userGroups = groups;
        req.supabaseGroups = groups;
        req.hasGroup = (groupName) => {
            if (!groupName) {
                return false;
            }
            const normalized = String(groupName).trim().toLowerCase();
            if (!normalized) {
                return false;
            }
            return groups.includes(normalized);
        };

        next();
    } catch (err) {
        console.error('Supabase authentication failed:', err.message);
        res.status(500).json({ error: 'Failed to verify Supabase session' });
    }
}

function normalizeGroupName(groupName) {
    if (!groupName) {
        return null;
    }
    const normalized = String(groupName).trim().toLowerCase();
    return normalized || null;
}

function getRequestGroups(req) {
    if (Array.isArray(req.userGroups)) {
        return req.userGroups;
    }
    if (Array.isArray(req.supabaseGroups)) {
        return req.supabaseGroups;
    }
    return [];
}

function requireGroup(...groupNames) {
    const normalizedGroups = Array.from(
        new Set(
            groupNames
                .flat()
                .map(normalizeGroupName)
                .filter(Boolean)
        )
    );

    return (req, res, next) => {
        if (!req.supabaseUser) {
            res.status(401).json({ error: 'Supabase authentication required' });
            return;
        }

        if (normalizedGroups.length === 0) {
            next();
            return;
        }

        const groups = getRequestGroups(req);
        const hasGroup = normalizedGroups.some((requiredGroup) => {
            if (typeof req.hasGroup === 'function') {
                return req.hasGroup(requiredGroup);
            }
            return groups.includes(requiredGroup);
        });

        if (!hasGroup) {
            res.status(403).json({
                error: 'Insufficient permissions',
                required_groups: normalizedGroups
            });
            return;
        }

        next();
    };
}

async function getPilotBySupabaseUserId(supabaseUserId) {
    if (!supabaseUserId) {
        return null;
    }
    try {
        return await dbGet('SELECT * FROM pilots WHERE supabase_user_id = ?', [supabaseUserId]);
    } catch (err) {
        console.error('Failed to load pilot by Supabase ID:', err.message);
        throw err;
    }
}

async function getPilotById(pilotId) {
    if (!pilotId) {
        return null;
    }
    return dbGet('SELECT * FROM pilots WHERE pilot_id = ?', [pilotId]);
}

async function getPilotByTicketId(ticketId) {
    if (!ticketId) {
        return null;
    }
    const ticket = await dbGet('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]).catch(() => null);
    if (!ticket) {
        return null;
    }
    return getPilotById(ticket.pilot_id);
}

async function upsertPilotProfile(user, profileUpdates = {}) {
    if (!user || !user.id) {
        throw new Error('Supabase user information missing');
    }

    const sanitizeVehicleId = (value) => {
        if (value === undefined || value === null) {
            return null;
        }
        const trimmed = String(value).trim();
        return trimmed.length > 0 ? trimmed : null;
    };

    const existing = await getPilotBySupabaseUserId(user.id);
    const existingVehicleId = sanitizeVehicleId(existing?.vehicle_id);
    const desiredDisplayName = profileUpdates.display_name
        ?? profileUpdates.pilot_name
        ?? existing?.display_name
        ?? user.user_metadata?.full_name
        ?? user.email
        ?? 'Unnamed Pilot';
    const desiredEmail = profileUpdates.email ?? existing?.email ?? user.email ?? null;
    const desiredAvatar = profileUpdates.avatar_url ?? existing?.avatar_url ?? user.user_metadata?.avatar_url ?? null;
    const desiredWallet = profileUpdates.wallet_address ?? existing?.wallet_address ?? null;
    const desiredVehicleId = profileUpdates.vehicle_id !== undefined
        ? sanitizeVehicleId(profileUpdates.vehicle_id)
        : existingVehicleId;

    if (existing) {
        const fields = [];
        const values = [];

        if (desiredDisplayName !== existing.display_name) {
            fields.push('display_name = ?');
            values.push(desiredDisplayName);
        }
        if (desiredEmail !== existing.email) {
            fields.push('email = ?');
            values.push(desiredEmail);
        }
        if (desiredAvatar !== existing.avatar_url) {
            fields.push('avatar_url = ?');
            values.push(desiredAvatar);
        }
        if (desiredWallet !== existing.wallet_address) {
            fields.push('wallet_address = ?');
            values.push(desiredWallet);
        }
        if (desiredVehicleId !== existingVehicleId) {
            fields.push('vehicle_id = ?');
            values.push(desiredVehicleId);
        }

        if (fields.length > 0) {
            fields.push('updated_at = CURRENT_TIMESTAMP');
            values.push(existing.pilot_id);
            await dbRun('UPDATE pilots SET ' + fields.join(', ') + ' WHERE pilot_id = ?', values);
        }

        const pointsRecord = await dbGet('SELECT * FROM pilot_points WHERE pilot_id = ?', [existing.pilot_id]);
        if (!pointsRecord) {
            await dbRun(
                'INSERT INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent) VALUES (?, ?, ?, ?)',
                [existing.pilot_id, 0, 0, 0]
            );
        }

        return getPilotBySupabaseUserId(user.id);
    }

    const pilotId = uuidv4();
    await dbRun(
        'INSERT INTO pilots (pilot_id, supabase_user_id, display_name, email, avatar_url, wallet_address, vehicle_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [pilotId, user.id, desiredDisplayName, desiredEmail, desiredAvatar, desiredWallet, desiredVehicleId]
    );

    await dbRun(
        'INSERT INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent) VALUES (?, ?, ?, ?)',
        [pilotId, 0, 0, 0]
    );

    return getPilotById(pilotId);
}

function normalizePaymentStatus(status) {
    if (!status) {
        return 'pending';
    }
    const normalized = String(status).toLowerCase();
    if (normalized === 'cancelled') {
        return 'canceled';
    }
    const allowed = ['pending', 'paid', 'canceled', 'refunded'];
    if (allowed.includes(normalized)) {
        return normalized;
    }
    return 'pending';
}


// API Routes

// Get all devices
app.get('/api/devices', authenticateSupabase, requireOps, (req, res) => {
    const query = `
        SELECT d.*,
               p.display_name AS current_pilot_display_name,
               p.supabase_user_id AS current_pilot_supabase_user_id,
               t.payment_status AS current_ticket_status,
               t.ticket_type AS current_ticket_type,
               t.package_minutes AS current_ticket_package_minutes,
               t.package_label AS current_ticket_package_label,
               ls.allocated_minutes AS current_session_allocated_minutes,
               ls.package_label AS current_session_package_label,
               ls.driver_name AS current_session_driver_name,
               ls.status AS current_session_status
        FROM devices d
        LEFT JOIN pilots p ON d.current_pilot_id = p.pilot_id
        LEFT JOIN tickets t ON d.current_ticket_id = t.ticket_id
        LEFT JOIN lap_sessions ls ON d.current_session_id = ls.session_id
        ORDER BY d.last_seen DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        // Calculate dynamic status based on last_seen timestamp using UTC
        const now = new Date();
        const devicesWithStatus = rows.map(device => {
            const {
                current_pilot_display_name,
                current_pilot_supabase_user_id,
                current_ticket_status,
                current_ticket_type,
                current_ticket_package_minutes,
                current_ticket_package_label,
                current_session_allocated_minutes,
                current_session_package_label,
                current_session_driver_name,
                current_session_status,
                ...rest
            } = device;

            // SQLite CURRENT_TIMESTAMP is UTC, so parse as UTC
            const lastSeen = parseTimestamp(device.last_seen) || now;
            const timeSinceLastSeen = (now - lastSeen) / 1000; // seconds
            
            // Consider device online if seen within last 30 seconds
            const isOnline = timeSinceLastSeen < 30;

            const resolvedPilotName = rest.current_pilot_name || current_pilot_display_name || current_session_driver_name || null;
            const pilotInfo = rest.current_pilot_id || resolvedPilotName ? {
                pilot_id: rest.current_pilot_id || null,
                display_name: resolvedPilotName,
                supabase_user_id: current_pilot_supabase_user_id || null
            } : null;

            const ticketInfo = rest.current_ticket_id ? {
                ticket_id: rest.current_ticket_id,
                status: current_ticket_status || null,
                ticket_type: current_ticket_type || null,
                package_minutes: current_ticket_package_minutes || null,
                package_label: current_ticket_package_label || null
            } : null;

            let dynamicRemaining = rest.session_remaining || 0;
            let isSessionActive = !!rest.session_start_time;
            let expired = false;
            if (rest.session_start_time) {
                const startTime = parseTimestamp(rest.session_start_time);
                if (startTime) {
                    const nowDate = new Date();
                    const elapsedSeconds = Math.max(0, Math.floor((nowDate - startTime) / 1000));
                    dynamicRemaining = Math.max(0, (rest.session_duration || 0) - elapsedSeconds);
                    expired = dynamicRemaining === 0 && (rest.session_duration || 0) > 0;
                }
            }

            const sessionStatus = current_session_status !== undefined ? current_session_status : null;
            const sessionInfo = rest.current_session_id ? {
                session_id: rest.current_session_id,
                allocated_minutes: current_session_allocated_minutes || current_ticket_package_minutes || null,
                package_label: current_session_package_label || current_ticket_package_label || null,
                duration_seconds: rest.session_duration || null,
                remaining_seconds: dynamicRemaining,
                is_active: isSessionActive,
                status: sessionStatus,
                is_paused: sessionStatus === 2,
                expired
            } : null;

            rest.session_remaining = dynamicRemaining;

            return {
                ...rest,
                status: isOnline ? 'online' : 'offline',
                time_since_last_seen: Math.floor(timeSinceLastSeen),
                current_pilot: pilotInfo,
                current_ticket: ticketInfo,
                current_session: sessionInfo
            };
        });
        
        res.json({ devices: devicesWithStatus });
    });
});

// Register/Update device
app.post('/api/devices/register', (req, res) => {
    const { device_id, mac_address, device_name, battery_level, battery_charging, wifi_channel } = req.body;
    
    // Support both new device_id and legacy mac_address
    const identifier = device_id || mac_address;
    const identifierColumn = device_id ? 'device_id' : 'mac_address';
    
    if (!identifier) {
        res.status(400).json({ error: 'Device ID or MAC address is required' });
        return;
    }

    let wifiChannelValue = null;
    if (wifi_channel !== undefined && wifi_channel !== null) {
        const parsed = parseInt(wifi_channel, 10);
        if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 200) {
            wifiChannelValue = parsed;
        }
    }

    // Check if device exists
    db.get(`SELECT * FROM devices WHERE ${identifierColumn} = ?`, [identifier], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (row) {
            // Update existing device
            const updateParams = ['online', mac_address || row.mac_address];
            let updateQuery = `UPDATE devices SET last_seen = CURRENT_TIMESTAMP, status = ?, mac_address = ?`;
            
            // Add battery data if provided
            if (battery_level !== undefined) {
                updateQuery += `, battery_level = ?`;
                updateParams.push(battery_level);
            }
            if (battery_charging !== undefined) {
                updateQuery += `, battery_charging = ?`;
                updateParams.push(battery_charging ? 1 : 0);
            }
            if (wifiChannelValue !== null) {
                updateQuery += `, wifi_channel = ?`;
                updateParams.push(wifiChannelValue);
            }
            
            updateQuery += ` WHERE ${identifierColumn} = ?`;
            updateParams.push(identifier);
            
            db.run(updateQuery, updateParams, function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json({ message: 'Device updated', device_id: row.id, wifi_channel: wifiChannelValue ?? row.wifi_channel });
            });
        } else {
            // Create new device
            const uuid = uuidv4();
            const defaultName = device_name || (mac_address ? `FPVue-${mac_address.slice(-6)}` : `FPVue-${identifier.slice(-6)}`);
            
            const insertParams = [uuid, identifier, mac_address, defaultName, 'online'];
            let insertQuery = 'INSERT INTO devices (id, device_id, mac_address, device_name, status';
            let insertValues = 'VALUES (?, ?, ?, ?, ?';
            
            // Add battery data if provided
            if (battery_level !== undefined) {
                insertQuery += ', battery_level';
                insertValues += ', ?';
                insertParams.push(battery_level);
            }
            if (battery_charging !== undefined) {
                insertQuery += ', battery_charging';
                insertValues += ', ?';
                insertParams.push(battery_charging ? 1 : 0);
            }
            if (wifiChannelValue !== null) {
                insertQuery += ', wifi_channel';
                insertValues += ', ?';
                insertParams.push(wifiChannelValue);
            }
            
            insertQuery += ') ' + insertValues + ')';
            
            db.run(insertQuery, insertParams, function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json({ message: 'Device registered', device_id: uuid, wifi_channel: wifiChannelValue ?? 173 });
            });
        }
    });
});

// Get device configuration
app.get('/api/devices/:identifier/config', (req, res) => {
    const { identifier } = req.params;
    
    // Try device_id first, then fallback to mac_address
    db.get(`
        SELECT d.*, 
               t.package_label,
               t.package_minutes,
               t.event_name,
               t.purchased_at,
               p.display_name as pilot_display_name,
               p.email as pilot_email
        FROM devices d
        LEFT JOIN tickets t ON d.current_ticket_id = t.ticket_id
        LEFT JOIN pilots p ON d.current_pilot_id = p.pilot_id
        WHERE d.device_id = ? OR d.mac_address = ?
    `, [identifier, identifier], (err, row) => {
        if (err) {
            console.error('Error fetching device config:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }
        
        fetchStartLineState((stateErr, startLine) => {
            if (stateErr) {
                console.error('Error fetching start line state:', stateErr);
                res.status(500).json({ error: 'Failed to load start line state' });
                return;
            }

            const rawMode = row.display_mode ? row.display_mode.toLowerCase() : 'curved';
            let normalizedMode = rawMode;
            if (rawMode === 'single') {
                normalizedMode = 'flat';
            } else if (rawMode === 'triple') {
                normalizedMode = 'curved';
            } else if (!['flat', 'curved'].includes(rawMode)) {
                normalizedMode = 'curved';
            }

            const response = {
                wifi_channel: row.wifi_channel,
                display_mode: normalizedMode,
                start_line: startLine
            };

            // Add current assignment info if available
            if (row.current_ticket_id) {
                response.current_assignment = {
                    ticket_id: row.current_ticket_id,
                    pilot_id: row.current_pilot_id,
                    pilot_name: row.current_pilot_name || row.pilot_display_name,
                    pilot_email: row.pilot_email,
                    package_label: row.package_label,
                    package_minutes: row.package_minutes,
                    event_name: row.event_name,
                    assigned_at: new Date().toISOString()
                };
            }

            res.json(response);
        });
    });
});

// Update device WiFi channel
app.put('/api/devices/:identifier/wifi-channel', authenticateSupabase, requireOps, (req, res) => {
    const { identifier } = req.params;
    const { wifi_channel } = req.body;
    
    if (!wifi_channel || wifi_channel < 1 || wifi_channel > 200) {
        res.status(400).json({ error: 'Invalid WiFi channel (must be 1-200)' });
        return;
    }
    
    db.run(
        'UPDATE devices SET wifi_channel = ? WHERE device_id = ? OR mac_address = ?',
        [wifi_channel, identifier, identifier],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (this.changes === 0) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }
            
            res.json({ message: 'WiFi channel updated', wifi_channel: wifi_channel });
        }
    );
});

// Update device display mode
app.put('/api/devices/:identifier/display-mode', authenticateSupabase, requireOps, (req, res) => {
    const { identifier } = req.params;
    let { display_mode } = req.body;
    
    if (!display_mode) {
        res.status(400).json({ error: 'Display mode is required' });
        return;
    }
    
    const rawMode = String(display_mode).toLowerCase();
    let normalizedMode = rawMode;
    if (rawMode === 'single') {
        normalizedMode = 'flat';
    } else if (rawMode === 'triple') {
        normalizedMode = 'curved';
    }

    if (!['flat', 'curved'].includes(normalizedMode)) {
        res.status(400).json({ error: 'Invalid display mode (supported: flat, curved)' });
        return;
    }
    
    db.run(
        'UPDATE devices SET display_mode = ? WHERE device_id = ? OR mac_address = ?',
        [normalizedMode, identifier, identifier],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (this.changes === 0) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }
            
            res.json({ message: 'Display mode updated', display_mode: normalizedMode });
        }
    );
});

// Start session for device
app.post('/api/devices/:identifier/session/start', authenticateSupabase, requireOps, async (req, res) => {
    const { identifier } = req.params;
    const { duration, driver_name, package_label } = req.body;

    const parsedDuration = Number(duration);
    const sessionDuration = Number.isFinite(parsedDuration)
        ? Math.max(60, Math.min(14400, Math.floor(parsedDuration)))
        : 1800;

    try {
        const device = await dbGet('SELECT * FROM devices WHERE device_id = ? OR mac_address = ?', [identifier, identifier]);
        if (!device) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }

        const sessionId = uuidv4();
        const sessionStartIso = new Date().toISOString();
        const sessionStartSeconds = Math.floor(Date.now() / 1000);

        const resolvedPilotId = device.current_pilot_id || null;
        const resolvedTicketId = device.current_ticket_id || null;
        const resolvedDriverName = (driver_name && String(driver_name).trim())
            || device.current_pilot_name
            || device.device_name
            || 'Manual Session';
        const resolvedPackageLabel = (package_label && String(package_label).trim())
            || (resolvedTicketId ? 'Ticket Package' : 'Manual');
        const allocatedMinutes = Math.max(1, Math.round(sessionDuration / 60));

        await dbRun(
            `UPDATE devices
             SET session_start_time = ?,
                 session_duration = ?,
                 session_remaining = ?,
                 current_session_id = ?,
                 current_pilot_name = CASE
                     WHEN (current_pilot_id IS NULL OR TRIM(current_pilot_id) = '') THEN ?
                     ELSE current_pilot_name
                 END
             WHERE id = ?`,
            [sessionStartIso, sessionDuration, sessionDuration, sessionId, resolvedDriverName, device.id]
        );

        await dbRun(
            `INSERT INTO lap_sessions (
                session_id,
                device_id,
                pilot_id,
                ticket_id,
                driver_name,
                track_name,
                session_start_time,
                status,
                allocated_minutes,
                package_label
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                sessionId,
                device.device_id,
                resolvedPilotId,
                resolvedTicketId,
                resolvedDriverName,
                null,
                sessionStartSeconds,
                1,
                allocatedMinutes,
                resolvedPackageLabel
            ]
        );

        res.json({
            message: 'Session started',
            start_time: sessionStartIso,
            duration: sessionDuration,
            remaining: sessionDuration,
            session_id: sessionId,
            driver_name: resolvedDriverName,
            allocated_minutes: allocatedMinutes,
            package_label: resolvedPackageLabel
        });
    } catch (err) {
        console.error('Failed to start manual session:', err);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

app.post('/api/devices/:identifier/session/pause', authenticateSupabase, requireOps, async (req, res) => {
    const { identifier } = req.params;
    try {
        const device = await dbGet('SELECT * FROM devices WHERE device_id = ? OR mac_address = ?', [identifier, identifier]);
        if (!device) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }

        if (!device.current_session_id) {
            res.status(409).json({ error: 'No active session to pause' });
            return;
        }

        if (!device.session_start_time) {
            res.status(409).json({ error: 'Session is already paused' });
            return;
        }

        const remainingSeconds = calculateRemainingSeconds(device);

        await dbRun(
            `UPDATE devices
             SET session_start_time = NULL,
                 session_duration = ?,
                 session_remaining = ?
             WHERE device_id = ? OR mac_address = ?`,
            [remainingSeconds, remainingSeconds, identifier, identifier]
        );

        await dbRun(
            `UPDATE lap_sessions
             SET status = 2
             WHERE session_id = ?`,
            [device.current_session_id]
        );

        res.json({
            message: 'Session paused',
            remaining: remainingSeconds,
            session_id: device.current_session_id
        });
    } catch (err) {
        console.error('Failed to pause session:', err);
        res.status(500).json({ error: 'Failed to pause session' });
    }
});

app.post('/api/devices/:identifier/session/resume', authenticateSupabase, requireOps, async (req, res) => {
    const { identifier } = req.params;
    try {
        const device = await dbGet('SELECT * FROM devices WHERE device_id = ? OR mac_address = ?', [identifier, identifier]);
        if (!device) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }

        if (!device.current_session_id) {
            res.status(409).json({ error: 'No paused session to resume' });
            return;
        }

        if (device.session_start_time) {
            res.status(409).json({ error: 'Session is already running' });
            return;
        }

        const remainingSeconds = Number(device.session_remaining || device.session_duration || 0);
        if (remainingSeconds <= 0) {
            res.status(409).json({ error: 'Session has no remaining time to resume' });
            return;
        }

        const sessionStartIso = new Date().toISOString();

        await dbRun(
            `UPDATE devices
             SET session_start_time = ?,
                 session_duration = ?,
                 session_remaining = ?
             WHERE device_id = ? OR mac_address = ?`,
            [sessionStartIso, remainingSeconds, remainingSeconds, identifier, identifier]
        );

        await dbRun(
            `UPDATE lap_sessions
             SET status = 1
             WHERE session_id = ?`,
            [device.current_session_id]
        );

        res.json({
            message: 'Session resumed',
            session_id: device.current_session_id,
            duration: remainingSeconds,
            remaining: remainingSeconds,
            start_time: sessionStartIso
        });
    } catch (err) {
        console.error('Failed to resume session:', err);
        res.status(500).json({ error: 'Failed to resume session' });
    }
});

// Stop session for device
app.post('/api/devices/:identifier/session/stop', authenticateSupabase, requireOps, async (req, res) => {
    const { identifier } = req.params;

    try {
        const device = await dbGet('SELECT * FROM devices WHERE device_id = ? OR mac_address = ?', [identifier, identifier]);
        if (!device) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }

        const sessionId = device.current_session_id;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const nowIso = new Date().toISOString();
        let resetDuration = Number(device.session_duration || 1800);

        if (sessionId) {
            const sessionRecord = await dbGet('SELECT allocated_minutes FROM lap_sessions WHERE session_id = ?', [sessionId]).catch(() => null);
            if (sessionRecord && sessionRecord.allocated_minutes) {
                resetDuration = Math.max(60, Number(sessionRecord.allocated_minutes) * 60);
            }
        }

        await dbRun(
            'UPDATE devices SET session_start_time = NULL, session_duration = ?, session_remaining = ?, current_session_id = NULL WHERE device_id = ? OR mac_address = ?',
            [resetDuration, resetDuration, identifier, identifier]
        );

        if (sessionId) {
            await dbRun(
                `UPDATE lap_sessions
                 SET status = 3,
                     session_end_time = ?,
                     uploaded = 0
                 WHERE session_id = ?`,
                [nowSeconds, sessionId]
            );
        }

        res.json({ message: 'Session stopped', stopped_at: nowIso, session_id: sessionId || null });
    } catch (err) {
        console.error('Failed to stop manual session:', err);
        res.status(500).json({ error: 'Failed to stop session' });
    }
});

// Get session info for device
app.get('/api/devices/:identifier/session', authenticateSupabase, requireOps, (req, res) => {
    const { identifier } = req.params;

    const query = `
        SELECT 
            d.session_start_time,
            d.session_duration,
            d.session_remaining,
            d.current_pilot_name,
            d.current_ticket_id,
            d.current_session_id,
            p.display_name AS pilot_display_name,
            t.package_minutes,
            t.package_label,
            ls.allocated_minutes,
            ls.package_label AS session_package_label,
            ls.driver_name AS session_driver_name,
            ls.status AS session_status
        FROM devices d
        LEFT JOIN pilots p ON d.current_pilot_id = p.pilot_id
        LEFT JOIN tickets t ON d.current_ticket_id = t.ticket_id
        LEFT JOIN lap_sessions ls ON d.current_session_id = ls.session_id
        WHERE d.device_id = ? OR d.mac_address = ?
    `;

    db.get(query, [identifier, identifier], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (!row) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }

        const pilotName = row.current_pilot_name || row.pilot_display_name || row.session_driver_name || null;
        const packageMinutes = row.allocated_minutes || row.package_minutes || 0;
        const packageLabel = row.session_package_label || row.package_label || null;
        const sessionId = row.current_session_id || null;
        const ticketId = row.current_ticket_id || null;
        const sessionStatus = row.session_status;
        const isPaused = sessionStatus === 2;

        let sessionInfo = {
            is_active: !!row.session_start_time,
            duration: row.session_duration,
            remaining: row.session_remaining,
            pilot_name: pilotName,
            driver_name: row.session_driver_name || pilotName,
            package_minutes: packageMinutes,
            package_label: packageLabel,
            ticket_id: ticketId,
            session_id: sessionId,
            status: sessionStatus,
            is_paused: isPaused
        };

        if (row.session_start_time) {
            const startTime = parseTimestamp(row.session_start_time);
            if (startTime) {
                const now = new Date();
                const elapsedSeconds = Math.max(0, Math.floor((now - startTime) / 1000));
                const remaining = Math.max(0, (row.session_duration || 0) - elapsedSeconds);

                sessionInfo.start_time = row.session_start_time;
                sessionInfo.elapsed = elapsedSeconds;
                sessionInfo.remaining = remaining;
                sessionInfo.expired = remaining === 0;
            }
        } else if (isPaused) {
            sessionInfo.remaining = Number(row.session_remaining || row.session_duration || 0);
        }

        res.json(sessionInfo);
    });
});

// Update device session duration
app.put('/api/devices/:identifier/session/duration', authenticateSupabase, requireOps, (req, res) => {
    const { identifier } = req.params;
    const { duration } = req.body;
    
    if (!duration || duration < 60 || duration > 14400) { // 1 minute to 4 hours
        res.status(400).json({ error: 'Invalid duration (must be 60-14400 seconds)' });
        return;
    }
    
    db.run(
        'UPDATE devices SET session_duration = ?, session_remaining = ? WHERE device_id = ? OR mac_address = ?',
        [duration, duration, identifier, identifier],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (this.changes === 0) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }
            
            res.json({ message: 'Session duration updated', duration: duration });
        }
    );
});

// Update device name
app.put('/api/devices/:identifier/name', authenticateSupabase, requireOps, (req, res) => {
    const { identifier } = req.params;
    const { device_name } = req.body;
    
    if (!device_name) {
        res.status(400).json({ error: 'Device name is required' });
        return;
    }
    
    db.run(
        'UPDATE devices SET device_name = ? WHERE device_id = ? OR mac_address = ?',
        [device_name, identifier, identifier],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            if (this.changes === 0) {
                res.status(404).json({ error: 'Device not found' });
                return;
            }
            
            res.json({ message: 'Device name updated', device_name: device_name });
        }
    );
});

// Delete device
app.delete('/api/devices/:identifier', authenticateSupabase, requireOps, (req, res) => {
    const { identifier } = req.params;
    
    db.run('DELETE FROM devices WHERE device_id = ? OR mac_address = ?', [identifier, identifier], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (this.changes === 0) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }
        
        res.json({ message: 'Device deleted' });
    });
});

// Start line endpoints (Ops access only)
app.get('/api/system/start-line', authenticateSupabase, requireOps, (req, res) => {
    fetchStartLineState((err, state) => {
        if (err) {
            res.status(500).json({ error: 'Failed to load start line state' });
            return;
        }
        res.json({ state, server_time_ms: Date.now() });
    });
});

app.post('/api/system/start-line/arm', authenticateSupabase, requireOps, (req, res) => {
    const now = Date.now();
    updateStartLineState(
        {
            status: 'armed',
            armed_at: now,
            countdown_started_at: null
        },
        (err) => {
            if (err) {
                res.status(500).json({ error: 'Failed to arm start line' });
                return;
            }

            fetchStartLineState((stateErr, state) => {
                if (stateErr) {
                    res.status(500).json({ error: 'Failed to load start line state' });
                    return;
                }
                res.json({ message: 'Start line armed', state });
            });
        }
    );
});

app.post('/api/system/start-line/start', authenticateSupabase, requireOps, (req, res) => {
    fetchStartLineState((err, current) => {
        if (err) {
            res.status(500).json({ error: 'Failed to load start line state' });
            return;
        }

        if (current.status !== 'armed') {
            res.status(409).json({ error: 'Start line must be armed before starting the countdown' });
            return;
        }

        const now = Date.now();
        updateStartLineState(
            {
                status: 'countdown',
                countdown_started_at: now
            },
            (updateErr) => {
                if (updateErr) {
                    res.status(500).json({ error: 'Failed to start countdown' });
                    return;
                }

                fetchStartLineState((stateErr, state) => {
                    if (stateErr) {
                        res.status(500).json({ error: 'Failed to load start line state' });
                        return;
                    }
                    res.json({ message: 'Countdown started', state });
                });
            }
        );
    });
});

app.post('/api/system/start-line/reset', authenticateSupabase, requireOps, (req, res) => {
    updateStartLineState(
        {
            status: 'idle',
            armed_at: null,
            countdown_started_at: null
        },
        (err) => {
            if (err) {
                res.status(500).json({ error: 'Failed to reset start line' });
                return;
            }

            fetchStartLineState((stateErr, state) => {
                if (stateErr) {
                    res.status(500).json({ error: 'Failed to load start line state' });
                    return;
                }
                res.json({ message: 'Start line reset', state });
            });
        }
    );
});
// ==================== PILOT & TICKETING API ENDPOINTS ====================
app.get('/api/pilots/me', authenticateSupabase, requirePilot, async (req, res) => {
    try {
        const pilot = await upsertPilotProfile(req.supabaseUser, {});
        if (!pilot) {
            res.json({ pilot: null, tickets: [], registrations: [] });
            return;
        }

        const tickets = await dbAll(
            'SELECT * FROM tickets WHERE pilot_id = ? ORDER BY purchased_at DESC',
            [pilot.pilot_id]
        );

        const registrations = await dbAll(
            SELECT r.*, d.device_name, t.payment_status, t.ticket_type
             FROM pit_lane_registrations r
             LEFT JOIN devices d ON r.device_id = d.device_id
             LEFT JOIN tickets t ON r.ticket_id = t.ticket_id
             WHERE r.pilot_id = ?
             ORDER BY r.check_in_time DESC,
            [pilot.pilot_id]
        );

        res.json({ pilot, tickets, registrations });
    } catch (err) {
        console.error('Failed to load pilot profile:', err);
        res.status(500).json({ error: 'Failed to load pilot profile' });
    }
});

app.post('/api/pilots/profile', authenticateSupabase, requirePilot, async (req, res) => {
    try {
        const { display_name, wallet_address, avatar_url, email, vehicle_id } = req.body;
        const pilot = await upsertPilotProfile(req.supabaseUser, {
            display_name,
            wallet_address,
            avatar_url,
            email,
            vehicle_id
        });
        res.json({ pilot });
    } catch (err) {
        console.error('Failed to update pilot profile:', err);
        res.status(500).json({ error: 'Failed to update pilot profile' });
    }
});

app.get('/api/pilots/vehicles', authenticateSupabase, requirePilot, async (req, res) => {
    try {
        if (!supabaseAdmin) {
            return res.json({ vehicles: [] });
        }

        const pilot = await getPilotBySupabaseUserId(req.supabaseUser.id);
        if (!pilot) {
            return res.json({ vehicles: [] });
        }

        const purchaseRows = await dbAll(
            'SELECT item_id FROM marketplace_purchases WHERE pilot_id = ?',
            [pilot.pilot_id]
        ).catch(() => []);
        const unlockRows = await dbAll(
            'SELECT item_id FROM pilot_unlocked_items WHERE pilot_id = ?',
            [pilot.pilot_id]
        ).catch(() => []);

        const itemIds = [...new Set([...purchaseRows, ...unlockRows]
            .map(row => row?.item_id)
            .filter(Boolean))];

        if (itemIds.length === 0) {
            return res.json({ vehicles: [] });
        }

        const { data: marketplaceItems, error: itemsError } = await supabaseAdmin
            .from('marketplace_items')
            .select('item_id, name, item_type, metadata')
            .in('item_id', itemIds);

        if (itemsError) {
            console.error('Failed to fetch marketplace items for owned vehicles:', itemsError);
            return res.status(500).json({ error: 'Failed to load owned vehicles' });
        }

        const parseMetadata = (value) => {
            if (!value) {
                return {};
            }
            if (typeof value === 'object') {
                return value || {};
            }
            try {
                return JSON.parse(value);
            } catch (err) {
                return {};
            }
        };

        const vehiclesFromItems = new Map();
        for (const item of marketplaceItems || []) {
            if (!item || item.item_type !== 'vehicle') {
                continue;
            }
            const metadata = parseMetadata(item.metadata);
            const vehicleId = metadata?.vehicle_id ? String(metadata.vehicle_id).trim() : null;
            if (!vehicleId) {
                continue;
            }

            if (!vehiclesFromItems.has(vehicleId)) {
                const source = purchaseRows.some(row => row?.item_id === item.item_id) ? 'purchase' : 'unlock';
                vehiclesFromItems.set(vehicleId, {
                    item_id: item.item_id,
                    item_name: item.name,
                    vehicle_id: vehicleId,
                    metadata,
                    source
                });
            }
        }

        if (vehiclesFromItems.size === 0) {
            return res.json({ vehicles: [] });
        }

        const vehicleIds = Array.from(vehiclesFromItems.keys());
        let vehicleRecords = [];
        try {
            const { data: vehicleRows, error: vehiclesError } = await supabaseAdmin
                .from('vehicles')
                .select('vehicle_id, vehicle_name, vehicle_type, metadata')
                .in('vehicle_id', vehicleIds);
            if (vehiclesError) {
                console.warn('Failed to fetch vehicle records for owned vehicles:', vehiclesError);
            } else {
                vehicleRecords = vehicleRows || [];
            }
        } catch (err) {
            console.warn('Unable to load vehicle registry details:', err);
        }

        const registryMap = new Map(vehicleRecords.map(record => [record.vehicle_id, record]));
        const vehicles = Array.from(vehiclesFromItems.values()).map(entry => {
            const registry = registryMap.get(entry.vehicle_id);
            const registryMetadata = registry?.metadata && typeof registry.metadata === 'object' ? registry.metadata : {};
            const combinedMetadata = { ...entry.metadata, ...registryMetadata };
            const vehicleName = registry?.vehicle_name || entry.metadata?.vehicle_name || entry.item_name || entry.vehicle_id;
            const vehicleType = registry?.vehicle_type || entry.metadata?.vehicle_type || null;

            return {
                item_id: entry.item_id,
                item_name: entry.item_name,
                vehicle_id: entry.vehicle_id,
                vehicle_name: vehicleName,
                vehicle_type: vehicleType,
                metadata: combinedMetadata,
                source: entry.source,
                is_current: pilot.vehicle_id ? pilot.vehicle_id === entry.vehicle_id : false
            };
        }).sort((a, b) => {
            const nameA = (a.vehicle_name || '').toLowerCase();
            const nameB = (b.vehicle_name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        res.json({ vehicles });
    } catch (err) {
        console.error('Failed to load owned vehicles:', err);
        res.status(500).json({ error: 'Failed to load owned vehicles' });
    }
});

app.get('/api/tickets/me', authenticateSupabase, requirePilot, async (req, res) => {
    try {
        const pilot = await getPilotBySupabaseUserId(req.supabaseUser.id);
        if (!pilot) {
            res.json({ tickets: [] });
            return;
        }

        const tickets = await dbAll(
            'SELECT * FROM tickets WHERE pilot_id = ? ORDER BY purchased_at DESC',
            [pilot.pilot_id]
        );
        res.json({ tickets });
    } catch (err) {
        console.error('Failed to load tickets:', err);
        res.status(500).json({ error: 'Failed to load tickets' });
    }
});

app.post('/api/tickets/purchase', authenticateSupabase, requirePilot, async (req, res) => {
    try {
        const {
            ticket_type,
            event_name,
            event_date,
            payment_amount,
            payment_currency,
            payment_reference,
            payment_status,
            wallet_address,
            pilot_name,
            email,
            package_id
        } = req.body;

        const marketplaceItems = await getMarketplaceItems();
        let selectedPackage = marketplaceItems.find(pkg => pkg.id === package_id);

        if (!selectedPackage) {
            const hardcodedPackages = [
                { id: 'PKG-S10', label: 'Sprint 10 minutos', minutes: 10 },
                { id: 'PKG-S20', label: 'Endurance 20 minutos', minutes: 20 },
                { id: 'PKG-S30', label: 'Maratona 30 minutos', minutes: 30 }
            ];
            selectedPackage = hardcodedPackages.find(pkg => pkg.id === package_id);
        }

        if (!selectedPackage) {
            console.log(Package validation failed for: );
            console.log('Available marketplace items:', marketplaceItems.map(p => p.id));
            res.status(400).json({ error: 'Pacote de minutos inv�lido' });
            return;
        }

        const packageLabel = selectedPackage.label;
        const packageMinutes = selectedPackage.minutes;

        const pilot = await upsertPilotProfile(req.supabaseUser, {
            display_name: pilot_name,
            wallet_address,
            email
        });

        if (!pilot) {
            res.status(500).json({ error: 'Pilot profile could not be created' });
            return;
        }

        let amountValue = null;
        if (payment_amount !== undefined && payment_amount !== null && payment_amount !== '') {
            const parsed = Number(payment_amount);
            if (Number.isNaN(parsed)) {
                res.status(400).json({ error: 'payment_amount must be numeric' });
                return;
            }
            amountValue = parsed;
        }

        let eventDateValue = null;
        if (event_date) {
            const parsedDate = new Date(event_date);
            if (!Number.isNaN(parsedDate.getTime())) {
                eventDateValue = parsedDate.toISOString();
            }
        }

        const ticketId = uuidv4();
        await dbRun(
            INSERT INTO tickets (
                ticket_id,
                pilot_id,
                ticket_type,
                payment_currency,
                payment_amount,
                payment_reference,
                payment_status,
                event_name,
                event_date,
                package_id,
                package_label,
                package_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
            [
                ticketId,
                pilot.pilot_id,
                ticket_type || 'race-pass',
                payment_currency || DEFAULT_PAYMENT_CURRENCY,
                amountValue ?? 0,
                payment_reference || null,
                normalizePaymentStatus(payment_status),
                event_name || null,
                eventDateValue,
                selectedPackage.id,
                packageLabel,
                packageMinutes
            ]
        );

        const ticket = await dbGet('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);

        res.status(201).json({ ticket, pilot });
    } catch (err) {
        console.error('Failed to record ticket purchase:', err);
        res.status(500).json({ error: 'Failed to record ticket purchase' });
    }
});

app.post('/api/pit-lane/register', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const {
            device_identifier,
            pilot_id,
            ticket_id,
            pilot_name,
            status,
            notes
        } = req.body;

        if (!device_identifier) {
            res.status(400).json({ error: 'device_identifier is required' });
            return;
        }

        const device = await dbGet(
            'SELECT * FROM devices WHERE device_id = ? OR mac_address = ?',
            [device_identifier, device_identifier]
        ).catch(() => null);

        if (!device) {
            res.status(404).json({ error: 'Device not found' });
            return;
        }

        let pilot = null;
        if (pilot_id) {
            pilot = await getPilotById(pilot_id).catch(() => null);
        }

        if (!pilot && ticket_id) {
            pilot = await getPilotByTicketId(ticket_id).catch(() => null);
        }

        if (!pilot && req.supabaseUser) {
            pilot = await getPilotBySupabaseUserId(req.supabaseUser.id).catch(() => null);
        }

        if (!pilot && pilot_name) {
            pilot = await dbGet(
                'SELECT * FROM pilots WHERE display_name = ? COLLATE NOCASE',
                [pilot_name]
            ).catch(() => null);
        }

        if (!pilot) {
            res.status(404).json({ error: 'Pilot profile not found for registration' });
            return;
        }

        let ticket = null;
        if (ticket_id) {
            ticket = await dbGet(
                'SELECT * FROM tickets WHERE ticket_id = ?',
                [ticket_id]
            ).catch(() => null);
        }

        if (!ticket) {
            const tickets = await dbAll(
                SELECT * FROM tickets
                 WHERE pilot_id = ?
                 AND payment_status = 'paid'
                 ORDER BY purchased_at DESC
                 LIMIT 1,
                [pilot.pilot_id]
            );
            ticket = tickets.length > 0 ? tickets[0] : null;
        }

        if (!ticket) {
            res.status(400).json({ error: 'No paid ticket found for pilot' });
            return;
        }

        if (ticket.payment_status !== 'paid') {
            res.status(400).json({ error: 'Ticket must be marked as paid before registration' });
            return;
        }

        if (ticket.redeemed) {
            res.status(400).json({ error: 'Ticket already redeemed' });
            return;
        }

        const packageMinutes = Number(ticket.package_minutes || 0);
        if (!packageMinutes || packageMinutes <= 0) {
            res.status(400).json({ error: 'Ticket is missing a valid minute package' });
            return;
        }

        const sessionSeconds = packageMinutes * 60;
        const nowSeconds = Math.floor(Date.now() / 1000);

        await dbRun(
            UPDATE pit_lane_registrations
             SET status = 'completed',
                 updated_at = CURRENT_TIMESTAMP
             WHERE device_id = ?
             AND status = 'active',
            [device.device_id]
        );

        await dbRun(
            UPDATE lap_sessions
             SET status = 3,
                 session_end_time = ?
             WHERE device_id = ?
               AND status IN (0,1,2) ,
            [nowSeconds, device.device_id]
        );

        const registrationId = uuidv4();
        const sessionId = uuidv4();
        const driverLabel = pilot_name || pilot.display_name;

        await dbRun(
            INSERT INTO lap_sessions (
                session_id,
                device_id,
                pilot_id,
                driver_name,
                track_name,
                session_start_time,
                status,
                ticket_id,
                allocated_minutes,
                package_label
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ,
            [
                sessionId,
                device.device_id,
                pilot.pilot_id,
                driverLabel,
                null,
                nowSeconds,
                1,
                ticket.ticket_id,
                packageMinutes,
                ticket.package_label || null
            ]
        );

        await dbRun(
            INSERT INTO pit_lane_registrations (
                registration_id,
                pilot_id,
                device_id,
                ticket_id,
                pilot_name,
                status,
                notes,
                session_id,
                allocated_minutes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ,
            [
                registrationId,
                pilot.pilot_id,
                device.device_id,
                ticket.ticket_id,
                driverLabel,
                status || 'active',
                notes || null,
                sessionId,
                packageMinutes
            ]
        );

        const pilotDisplayName = ticket.pilot_display_name || 
                               pilot.display_name || 
                               pilot_name || 
                               'Unknown Pilot';

        console.log(Assigning device  to pilot  ());

        await dbRun(
            UPDATE devices
             SET current_pilot_id = ?,
                 current_pilot_name = ?,
                 current_ticket_id = ?,
                 current_session_id = ?,
                 session_duration = ?,
                 session_start_time = ?,
                 session_remaining = ?,
                 updated_at = CURRENT_TIMESTAMP,
                 current_assignment = json_object(
                     'pilot_id', ?,
                     'pilot_name', ?,
                     'ticket_id', ?,
                     'assigned_at', datetime('now')
                 )
             WHERE device_id = ?,
            [
                pilot.pilot_id,
                pilotDisplayName,
                ticket.ticket_id,
                sessionId,
                sessionSeconds,
                nowSeconds,
                sessionSeconds,
                pilot.pilot_id,
                pilotDisplayName,
                ticket.ticket_id,
                device.device_id
            ]
        );

        console.log(Successfully assigned device  to );

        await dbRun(
            UPDATE tickets
             SET redeemed = 1,
                 minutes_consumed = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE ticket_id = ?,
            [packageMinutes, ticket.ticket_id]
        );

        const registration = await dbGet(
            SELECT r.*, d.device_name, t.payment_status, t.ticket_type
             FROM pit_lane_registrations r
             LEFT JOIN devices d ON r.device_id = d.device_id
             LEFT JOIN tickets t ON r.ticket_id = t.ticket_id
             WHERE r.registration_id = ?,
            [registrationId]
        );

        const session = await dbGet(
            SELECT * FROM lap_sessions WHERE session_id = ?,
            [sessionId]
        );

        const updatedTicket = await dbGet('SELECT * FROM tickets WHERE ticket_id = ?', [ticket.ticket_id]);

        res.status(201).json({
            registration,
            pilot,
            ticket: updatedTicket,
            session
        });
    } catch (err) {
        console.error('Failed to register pilot in pit lane:', err);
        res.status(500).json({ error: 'Failed to register pilot in pit lane' });
    }
});

app.get('/api/pit-lane/registrations', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const { status } = req.query;
        let query = 
            SELECT r.*, p.display_name AS pilot_display_name, p.supabase_user_id,
                   d.device_name,
                   t.payment_status, t.ticket_type,
                   ls.allocated_minutes AS session_allocated_minutes,
                   ls.package_label AS session_package_label
            FROM pit_lane_registrations r
            LEFT JOIN pilots p ON r.pilot_id = p.pilot_id
            LEFT JOIN devices d ON r.device_id = d.device_id
            LEFT JOIN tickets t ON r.ticket_id = t.ticket_id
            LEFT JOIN lap_sessions ls ON r.session_id = ls.session_id
        ;
        const params = [];

        if (status) {
            query += ' WHERE r.status = ?';
            params.push(status);
        }

        query += ' ORDER BY r.check_in_time DESC';

        const registrations = await dbAll(query, params);
        res.json({ registrations });
    } catch (err) {
        console.error('Failed to load pit lane registrations:', err);
        res.status(500).json({ error: 'Failed to load pit lane registrations' });
    }
});

app.get('/api/admin/pilots', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const { search } = req.query;
        const params = [];
        let query = 
            SELECT 
                p.*,
                COUNT(t.ticket_id) AS ticket_count,
                COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_ticket_count,
                COALESCE(SUM(CASE WHEN t.payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_ticket_count
            FROM pilots p
            LEFT JOIN tickets t ON p.pilot_id = t.pilot_id
        ;

        if (search) {
            query += ' WHERE p.display_name LIKE ? OR p.email LIKE ?';
            const like = %%;
            params.push(like, like);
        }

        query += ' GROUP BY p.pilot_id ORDER BY p.display_name COLLATE NOCASE';

        const pilots = await dbAll(query, params);
        res.json({ pilots });
    } catch (err) {
        console.error('Failed to load pilots:', err);
        res.status(500).json({ error: 'Failed to load pilot list' });
    }
});

app.get('/api/admin/tickets', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const { status, include_archived } = req.query;
        const params = [];
        const allowedStatuses = new Set(['pending', 'paid', 'canceled', 'refunded']);
        const normalizedStatus = status ? String(status).toLowerCase() : null;
        const includeArchived = typeof include_archived !== 'undefined'
            && ['1', 'true', 'yes', 'all'].includes(String(include_archived).toLowerCase());
        const conditions = [];

        let query = 
            SELECT 
                t.*,
                p.display_name AS pilot_display_name,
                p.email AS pilot_email,
                p.wallet_address AS pilot_wallet_address
            FROM tickets t
            LEFT JOIN pilots p ON t.pilot_id = p.pilot_id
        ;

        if (normalizedStatus && allowedStatuses.has(normalizedStatus)) {
            conditions.push('t.payment_status = ?');
            params.push(normalizedStatus);
        }

        if (!includeArchived) {
            conditions.push('t.archived = 0');
        }

        if (conditions.length) {
            query +=  WHERE ;
        }

        query += ' ORDER BY t.purchased_at DESC';

        const tickets = await dbAll(query, params);
        res.json({ tickets });
    } catch (err) {
        console.error('Failed to load tickets for admin:', err);
        res.status(500).json({ error: 'Failed to load tickets' });
    }
});

app.put('/api/admin/tickets/:ticketId/status', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { payment_status, payment_reference, payment_amount } = req.body;

        if (!payment_status) {
            res.status(400).json({ error: 'payment_status is required' });
            return;
        }

        const allowedStatuses = new Set(['pending', 'paid', 'canceled', 'refunded']);
        const normalizedStatus = String(payment_status).toLowerCase();
        if (!allowedStatuses.has(normalizedStatus)) {
            res.status(400).json({ error: 'Invalid payment status' });
            return;
        }

        const fields = ['payment_status = ?'];
        const values = [normalizedStatus];

        if (payment_reference !== undefined) {
            fields.push('payment_reference = ?');
            values.push(payment_reference || null);
        }

        if (payment_amount !== undefined) {
            if (payment_amount === null || payment_amount === '') {
                fields.push('payment_amount = NULL');
            } else {
                const amount = Number(payment_amount);
                if (Number.isNaN(amount)) {
                    res.status(400).json({ error: 'payment_amount must be numeric' });
                    return;
                }
                fields.push('payment_amount = ?');
                values.push(amount);
            }
        }

        if (normalizedStatus !== 'paid') {
            fields.push('redeemed = 0');
            fields.push('minutes_consumed = 0');
            fields.push('archived = 0');
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(ticketId);

        const updateResult = await dbRun(
            UPDATE tickets SET  WHERE ticket_id = ?,
            values
        );

        if (updateResult.changes === 0) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }

        const ticket = await dbGet(
            SELECT 
                t.*,
                p.display_name AS pilot_display_name,
                p.email AS pilot_email,
                p.wallet_address AS pilot_wallet_address
             FROM tickets t
             LEFT JOIN pilots p ON t.pilot_id = p.pilot_id
             WHERE t.ticket_id = ?,
            [ticketId]
        );

        res.json({ ticket });
    } catch (err) {
        console.error('Failed to update ticket status:', err);
        res.status(500).json({ error: 'Failed to update ticket status' });
    }
});

app.put('/api/admin/tickets/:ticketId/archive', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { archived } = req.body;

        if (archived === undefined) {
            res.status(400).json({ error: 'archived is required' });
            return;
        }

        let shouldArchive;
        if (typeof archived === 'boolean') {
            shouldArchive = archived;
        } else if (typeof archived === 'number') {
            shouldArchive = archived === 1;
        } else {
            const normalizedValue = String(archived).trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalizedValue)) {
                shouldArchive = true;
            } else if (['0', 'false', 'no', 'off'].includes(normalizedValue)) {
                shouldArchive = false;
            } else {
                res.status(400).json({ error: 'archived must be a boolean value' });
                return;
            }
        }

        const ticketRow = await dbGet(
            'SELECT redeemed, archived FROM tickets WHERE ticket_id = ?',
            [ticketId]
        );

        if (!ticketRow) {
            res.status(404).json({ error: 'Ticket not found' });
            return;
        }

        if (shouldArchive && !ticketRow.redeemed) {
            res.status(400).json({ error: 'Only redeemed tickets can be archived' });
            return;
        }

        await dbRun(
            UPDATE tickets
             SET archived = ?, updated_at = CURRENT_TIMESTAMP
             WHERE ticket_id = ?,
            [shouldArchive ? 1 : 0, ticketId]
        );

        const ticket = await dbGet(
            SELECT 
                t.*,
                p.display_name AS pilot_display_name,
                p.email AS pilot_email,
                p.wallet_address AS pilot_wallet_address
             FROM tickets t
             LEFT JOIN pilots p ON t.pilot_id = p.pilot_id
             WHERE t.ticket_id = ?,
            [ticketId]
        );

        res.json({ ticket });
    } catch (err) {
        console.error('Failed to update ticket archive state:', err);
        res.status(500).json({ error: 'Failed to update ticket archive state' });
    }
});

app.get('/api/admin/payment-settings', authenticateSupabase, requirePaymentsAdmin, async (req, res) => {
    try {
        const walletAddress = await getSystemSetting('payment.usdt_wallet', PAYMENT_USDT_ADDRESS);
        res.json({
            wallet_address: walletAddress || ''
        });
    } catch (err) {
        console.error('Failed to load payment settings:', err);
        res.status(500).json({ error: 'Failed to load payment settings' });
    }
});

app.put('/api/admin/payment-settings', authenticateSupabase, requirePaymentsAdmin, async (req, res) => {
    try {
        const { wallet_address } = req.body;
        const normalized = wallet_address !== undefined && wallet_address !== null
            ? String(wallet_address).trim()
            : '';

        await setSystemSetting('payment.usdt_wallet', normalized || null);

        res.json({
            wallet_address: normalized
        });
    } catch (err) {
        console.error('Failed to update payment settings:', err);
        res.status(500).json({ error: 'Failed to update payment settings' });
    }
});

app.put('/api/admin/pit-lane/registrations/:registrationId', authenticateSupabase, requirePitlane, async (req, res) => {
    try {
        const { registrationId } = req.params;
        const { status, notes } = req.body;
        const fields = [];
        const values = [];

        if (status !== undefined) {
            if (status === null || status === '') {
                res.status(400).json({ error: 'status cannot be empty' });
                return;
            }
            const normalized = String(status).toLowerCase();
            const allowedStatuses = new Set(['active', 'completed', 'canceled', 'released']);
            if (!allowedStatuses.has(normalized)) {
                res.status(400).json({ error: 'Invalid registration status' });
                return;
            }
            fields.push('status = ?');
            values.push(normalized);
        }

        if (notes !== undefined) {
            fields.push('notes = ?');
            values.push(notes || null);
        }

        if (fields.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(registrationId);

        const updateResult = await dbRun(
            UPDATE pit_lane_registrations SET  WHERE registration_id = ?,
            values
        );

        if (updateResult.changes === 0) {
            res.status(404).json({ error: 'Registration not found' });
            return;
        }

        const registration = await dbGet(
            SELECT r.*, p.display_name AS pilot_display_name, p.supabase_user_id,
                    d.device_name,
                    t.payment_status, t.ticket_type
             FROM pit_lane_registrations r
             LEFT JOIN pilots p ON r.pilot_id = p.pilot_id
             LEFT JOIN devices d ON r.device_id = d.device_id
             LEFT JOIN tickets t ON r.ticket_id = t.ticket_id
             WHERE r.registration_id = ?,
            [registrationId]
        );

        if (registration && ['completed', 'released', 'canceled'].includes(registration.status)) {
            await dbRun(
                UPDATE devices
                 SET current_pilot_id = NULL,
                     current_pilot_name = NULL,
                     current_ticket_id = NULL,
                     current_session_id = NULL,
                     session_start_time = NULL,
                     session_remaining = session_duration
                 WHERE device_id = ? AND current_session_id = ?,
                [registration.device_id, registration.session_id]
            ).catch(() => {});
        }

        res.json({ registration });
    } catch (err) {
        console.error('Failed to update pit lane registration:', err);
        res.status(500).json({ error: 'Failed to update pit lane registration' });
    }
});

app.get('/api/public-config', async (req, res) => {
    try {
        const walletAddress = await getSystemSetting('payment.usdt_wallet', PAYMENT_USDT_ADDRESS);
        const marketplaceItems = await getMarketplaceItems();
        res.json({
            supabase: (SUPABASE_URL && SUPABASE_ANON_KEY)
                ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
                : null,
            payments: {
                defaultCurrency: DEFAULT_PAYMENT_CURRENCY,
                supportsUSDT: true,
                walletAddress: walletAddress || null,
                minutePackages: marketplaceItems
            }
        });
    } catch (err) {
        console.error('Failed to load public config:', err);
        res.status(500).json({ error: 'Failed to load configuration' });
    }
});

// Simple test endpoint to check if the route works
app.get('/api/rewards/test', authenticateSupabase, requireAdmin, (req, res) => {
    console.log('🧪 Test API called');
    res.json({ message: 'Test API working', timestamp: new Date().toISOString() });
});

// Debug endpoint for Nelson Piquet unlock issue
app.get('/api/debug/nelson-unlock', authenticateSupabase, requireAdmin, async (req, res) => {
    try {
        // Find Nelson Piquet in SQLite
        const nelson = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM pilots WHERE LOWER(display_name) LIKE ? OR LOWER(pilot_name) LIKE ?', 
                ['%nelson%', '%nelson%'], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!nelson) {
            return res.json({ error: 'Nelson Piquet not found in pilots table' });
        }

        // Get Nelson's achievements from SQLite
        const nelsonAchievements = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM pilot_achievements WHERE pilot_id = ?', [nelson.pilot_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get Nelson's unlocked items from SQLite  
        const nelsonUnlockedItems = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM pilot_unlocked_items WHERE pilot_id = ?', [nelson.pilot_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get all achievements from Supabase
        const { data: supabaseAchievements, error: achievementError } = await supabaseAdmin
            .from('achievements')
            .select('*');

        // Get all marketplace items from Supabase
        const { data: supabaseItems, error: itemError } = await supabaseAdmin
            .from('marketplace_items')
            .select('*');

        // Find First Flight achievement specifically
        const firstFlightAchievement = supabaseAchievements?.find(a => 
            a.name.toLowerCase().includes('first flight') || 
            a.achievement_id === 'first-flight'
        );

        // Find Precision Handler item specifically
        const precisionHandlerItem = supabaseItems?.find(i => 
            i.name.toLowerCase().includes('precision handler')
        );

        // Test the unlock logic manually
        const unlockedItemIds = nelsonUnlockedItems.map(ui => ui.item_id);
        const unlockedAchievementIds = nelsonAchievements.map(pa => pa.achievement_id);
        
        // Get achievement unlocks manually
        const achievementUnlocks = supabaseAchievements?.filter(ach => ach.unlock_item_id) || [];
        
        const precisionHandlerProcessed = supabaseItems?.find(i => i.name.toLowerCase().includes('precision handler'));
        let precisionHandlerUnlocked = false;
        
        if (precisionHandlerProcessed) {
            // Check if unlocked via achievement
            const unlockingAchievement = achievementUnlocks.find(ach => 
                ach.unlock_item_id === precisionHandlerProcessed.item_id && unlockedAchievementIds.includes(ach.achievement_id)
            );
            if (unlockingAchievement) {
                precisionHandlerUnlocked = true;
            }
        }

        res.json({
            nelson_pilot: nelson,
            nelson_achievements_sqlite: nelsonAchievements,
            nelson_unlocked_items_sqlite: nelsonUnlockedItems,
            supabase_achievements: supabaseAchievements,
            supabase_items: supabaseItems,
            first_flight_achievement: firstFlightAchievement,
            precision_handler_item: precisionHandlerItem,
            achievement_error: achievementError,
            item_error: itemError,
            // Debug calculations
            unlocked_item_ids: unlockedItemIds,
            unlocked_achievement_ids: unlockedAchievementIds,
            achievement_unlocks: achievementUnlocks,
            precision_handler_processed: precisionHandlerProcessed,
            precision_handler_should_be_unlocked: precisionHandlerUnlocked
        });
    } catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve web interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server - bind to all interfaces for external access
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 FPVue Device Manager running on:`);
    console.log(`- Local: http://localhost:${PORT}`);
    console.log(`- Network: http://0.0.0.0:${PORT}`);
    console.log(`- WSL: Access from Windows using port forwarding`);
    
    // Get network interfaces
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    console.log(`\n📡 Available network interfaces:`);
    Object.keys(interfaces).forEach(name => {
        interfaces[name].forEach(net => {
            if (net.family === 'IPv4' && !net.internal) {
                console.log(`- ${name}: http://${net.address}:${PORT}`);
            }
        });
    });
    
    console.log(`\n🌐 For external device access:`);
    console.log(`1. Run setup-external-access.ps1 as Administrator`);
    console.log(`2. Use Windows host IP address in FPVue app`);
    console.log(`3. Test connectivity from external devices`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    db.close();
    process.exit(0);
});






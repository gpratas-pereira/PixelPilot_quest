/**
 * FPVue Rewards System API Routes
 * Handles pilot-facing rewards endpoints
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Middleware to ensure Supabase-authenticated user is present on the request
function authenticateUser(req, res, next) {
    if (!req.supabaseUser) {
        return res.status(401).json({ error: 'Supabase authentication required' });
    }

    req.user = req.supabaseUser;
    next();
}

/**
 * GET /api/rewards/points
 * Get current pilot's point balance
 */
router.get('/points', authenticateUser, async (req, res) => {
    try {
        // First, find the pilot_id using the Supabase user ID
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            // If no pilot found, return default points
            return res.json({ current_points: 0, lifetime_earned: 0, total_spent: 0 });
        }

        // Now get the points using the pilot_id
        const points = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilot_points WHERE pilot_id = ?', [pilot.pilot_id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || { current_points: 0, lifetime_earned: 0, total_spent: 0 });
                }
            });
        });

        res.json(points);
    } catch (err) {
        console.error('Error fetching points:', err);
        res.status(500).json({ error: 'Failed to fetch points' });
    }
});

/**
 * GET /api/rewards/activity
 * Get pilot's recent point transactions
 */
router.get('/activity', authenticateUser, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;

        // First, find the pilot_id using the Supabase user ID
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            // If no pilot found, return empty transactions
            return res.json({ transactions: [] });
        }

        const transactions = await new Promise((resolve, reject) => {
            req.db.all(
                'SELECT * FROM point_transactions WHERE pilot_id = ? ORDER BY created_at DESC LIMIT ?',
                [pilot.pilot_id, limit],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });

        res.json({ transactions });
    } catch (err) {
        console.error('Error fetching activity:', err);
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

/**
 * GET /api/rewards/marketplace
 * Get marketplace items with optional filtering, including lock/unlock status for pilot
 */
router.get('/marketplace', authenticateUser, async (req, res) => {
    try {
        const { type, search } = req.query;

        // Get pilot information using authenticated user
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            console.warn('⚠️  No pilot found for authenticated user');
            return res.json({ items: [] });
        }
        
        console.log('📦 Using pilot for marketplace:', pilot.pilot_id);

        // Get marketplace items from Supabase
        const { data: supabaseItems, error: itemsError } = await req.supabaseAdmin
            .from('marketplace_items')
            .select('*')
            .order('created_at', { ascending: false });

        if (itemsError) {
            console.error('Error fetching marketplace items from Supabase:', itemsError);
            return res.json({ items: [] });
        }

        // Get pilot's achievements from SQLite
        const pilotAchievements = await new Promise((resolve, reject) => {
            req.db.all('SELECT achievement_id FROM pilot_achievements WHERE pilot_id = ? AND unlocked_at IS NOT NULL', 
                [pilot.pilot_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get pilot's directly unlocked items from SQLite
        const pilotUnlockedItems = await new Promise((resolve, reject) => {
            req.db.all('SELECT item_id FROM pilot_unlocked_items WHERE pilot_id = ?', 
                [pilot.pilot_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get achievements that can unlock items from Supabase
        const { data: achievementUnlocks, error: achievementsError } = await req.supabaseAdmin
            .from('achievements')
            .select('achievement_id, unlock_item_id, name, description')
            .not('unlock_item_id', 'is', null);

        if (achievementsError) {
            console.error('Error fetching achievements from Supabase:', achievementsError);
        }

        const unlockedItemIds = pilotUnlockedItems.map(ui => ui.item_id);
        const unlockedAchievementIds = pilotAchievements.map(pa => pa.achievement_id);

        console.log(`📦 Nelson has ${pilotAchievements.length} unlocked achievements:`, unlockedAchievementIds);
        console.log(`📦 Found ${(achievementUnlocks || []).length} achievements that unlock items`);

        // Process items and determine lock status
        const processedItems = (supabaseItems || []).map(item => {
            let isLocked = true; // Default to locked
            let unlockAchievement = null;

            // Item is unlocked if it's in the pilot's unlocked items list
            if (unlockedItemIds.includes(item.item_id)) {
                isLocked = false;
            }
            // Check if any unlocked achievement points to this item
            else if (achievementUnlocks) {
                const unlockingAchievement = achievementUnlocks.find(ach => 
                    ach.unlock_item_id === item.item_id && unlockedAchievementIds.includes(ach.achievement_id)
                );
                if (unlockingAchievement) {
                    isLocked = false;
                    unlockAchievement = unlockingAchievement;
                } else {
                    // Find the achievement that can unlock this item for display
                    unlockAchievement = achievementUnlocks.find(ach => ach.unlock_item_id === item.item_id);
                }
            }
            // If item has no unlock requirements, it's unlocked by default
            if (!item.is_locked && !achievementUnlocks?.find(ach => ach.unlock_item_id === item.item_id)) {
                isLocked = false;
            }

            console.log(`📦 Item "${item.name}" (${item.item_id}): locked=${isLocked}, unlock_achievement=${unlockAchievement?.name || 'none'}`);

            return {
                ...item,
                metadata: item.metadata || {},
                is_locked: isLocked,
                can_purchase: !isLocked,
                unlock_requirement: isLocked && unlockAchievement ? {
                    type: 'achievement',
                    achievement_name: unlockAchievement.name,
                    achievement_description: unlockAchievement.description
                } : null
            };
        });

        // Apply filters if provided
        let filteredItems = processedItems;
        if (type && type !== 'all') {
            filteredItems = filteredItems.filter(item => item.item_type === type);
        }
        if (search) {
            const searchLower = search.toLowerCase();
            filteredItems = filteredItems.filter(item => 
                item.name.toLowerCase().includes(searchLower) || 
                item.description.toLowerCase().includes(searchLower)
            );
        }

        res.json({ items: filteredItems });
    } catch (err) {
        console.error('Error fetching marketplace:', err);
        res.status(500).json({ error: 'Failed to fetch marketplace items' });
    }
});

/**
 * POST /api/rewards/purchase
 * Purchase a marketplace item
 */
router.post('/purchase', authenticateUser, async (req, res) => {
    try {
        const { item_id, payment_method } = req.body;

        if (!item_id || !payment_method) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!['points', 'usdt'].includes(payment_method)) {
            return res.status(400).json({ error: 'Invalid payment method' });
        }

        // First, find the pilot_id using the Supabase user ID
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            return res.status(400).json({ error: 'Pilot profile not found' });
        }

        // Get item details from Supabase
        const { data: item, error: itemError } = await req.supabaseAdmin
            .from('marketplace_items')
            .select('*')
            .eq('item_id', item_id)
            .eq('is_active', true)
            .single();

        if (itemError || !item) {
            console.error('Item fetch error:', itemError);
            return res.status(404).json({ error: 'Item not found' });
        }

        // Check if item is locked and pilot has unlocked it
        if (item.is_locked) {
            // Check direct unlock first
            const unlockRecord = await new Promise((resolve, reject) => {
                req.db.get('SELECT * FROM pilot_unlocked_items WHERE pilot_id = ? AND item_id = ?', [pilot.pilot_id, item_id], (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                });
            });

            let isUnlocked = !!unlockRecord;

            // If not directly unlocked, check achievement-based unlock
            if (!isUnlocked) {
                // Get pilot's achievements
                const pilotAchievements = await new Promise((resolve, reject) => {
                    req.db.all('SELECT achievement_id FROM pilot_achievements WHERE pilot_id = ? AND unlocked_at IS NOT NULL', 
                        [pilot.pilot_id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    });
                });

                // Get achievements that can unlock this item
                const { data: achievementUnlocks } = await req.supabaseAdmin
                    .from('achievements')
                    .select('achievement_id, unlock_item_id')
                    .eq('unlock_item_id', item_id);

                if (achievementUnlocks && achievementUnlocks.length > 0) {
                    const unlockedAchievementIds = pilotAchievements.map(pa => pa.achievement_id);
                    const unlockingAchievement = achievementUnlocks.find(ach => 
                        unlockedAchievementIds.includes(ach.achievement_id)
                    );
                    
                    if (unlockingAchievement) {
                        isUnlocked = true;
                        console.log(`Item ${item_id} unlocked via achievement for pilot ${pilot.pilot_id}`);
                    }
                }
            }

            if (!isUnlocked) {
                return res.status(403).json({ 
                    error: 'Item is locked',
                    message: 'You need to unlock this item first by earning the required achievement'
                });
            }
        }

        // Check stock
        if (item.stock === 0) {
            return res.status(400).json({ error: 'Item out of stock' });
        }

        // Handle points payment
        if (payment_method === 'points') {
            if (!item.points_price) {
                return res.status(400).json({ error: 'Item not available for points' });
            }

            // Get pilot points from SQLite using pilot_id
            const pilotPoints = await new Promise((resolve, reject) => {
                req.db.get('SELECT * FROM pilot_points WHERE pilot_id = ?', [pilot.pilot_id], (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                });
            });

            if (!pilotPoints || pilotPoints.current_points < item.points_price) {
                return res.status(400).json({ error: 'Insufficient points' });
            }

            // Process purchase in transaction
            // 1. Deduct points
            await new Promise((resolve, reject) => {
                req.db.run(
                    'UPDATE pilot_points SET current_points = current_points - ?, total_spent = total_spent + ?, updated_at = CURRENT_TIMESTAMP WHERE pilot_id = ?',
                    [item.points_price, item.points_price, pilot.pilot_id],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ changes: this.changes });
                        }
                    }
                );
            });

            // 2. Record transaction in SQLite
            await new Promise((resolve, reject) => {
                req.db.run(
                    'INSERT INTO point_transactions (pilot_id, amount, transaction_type, reference_type, reference_id, description) VALUES (?, ?, ?, ?, ?, ?)',
                    [pilot.pilot_id, -item.points_price, 'spent', 'marketplace_item', item_id, `Purchased ${item.name}`],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ lastID: this.lastID });
                        }
                    }
                );
            });

            // 3. Record purchase in SQLite
            const purchaseId = uuidv4();
            await new Promise((resolve, reject) => {
                req.db.run(
                    'INSERT INTO marketplace_purchases (purchase_id, pilot_id, item_id, item_name, payment_method, points_paid) VALUES (?, ?, ?, ?, ?, ?)',
                    [purchaseId, pilot.pilot_id, item_id, item.name, 'points', item.points_price],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ lastID: this.lastID });
                        }
                    }
                );
            });

            // 4. Update stock if not unlimited
            if (item.stock > 0) {
                await new Promise((resolve, reject) => {
                    req.db.run(
                        'UPDATE marketplace_items SET stock = stock - 1, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?',
                        [item_id],
                        function(err) {
                            if (err) {
                                reject(err);
                            } else {
                                resolve({ changes: this.changes });
                            }
                        }
                    );
                });
            }

            // 5. Check for achievements
            await checkAchievements(req.db, pilot.pilot_id, 'marketplace_purchase', { item_id, amount: item.points_price });

            res.json({ success: true, message: 'Purchase successful' });
        } else {
            // USDT payment would be handled here
            // For now, return not implemented
            res.status(501).json({ error: 'USDT payment not yet implemented' });
        }
    } catch (err) {
        console.error('Error processing purchase:', err);
        res.status(500).json({ error: 'Failed to process purchase' });
    }
});

/**
 * GET /api/rewards/purchases
 * Get pilot's purchase history
 */
router.get('/purchases', authenticateUser, async (req, res) => {
    try {
        // First, find the pilot_id using the Supabase user ID
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            return res.json({ purchases: [] });
        }

        // Get marketplace purchase history
        const marketplacePurchases = await new Promise((resolve, reject) => {
            req.db.all(
                'SELECT *, "marketplace" as purchase_type FROM marketplace_purchases WHERE pilot_id = ? ORDER BY purchased_at DESC',
                [pilot.pilot_id],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });

        // Get ticket purchase history
        const ticketPurchases = await new Promise((resolve, reject) => {
            req.db.all(
                `SELECT ticket_id as purchase_id,
                        pilot_id,
                        COALESCE(package_label, event_name, 'Race Pass') as item_name,
                        payment_currency as payment_method,
                        payment_amount as points_paid,
                        payment_amount as usdt_paid,
                        purchased_at,
                        payment_status as status,
                        package_minutes,
                        payment_reference,
                        verification_error,
                        admin_reason,
                        redeemed,
                        "ticket" as purchase_type
                 FROM tickets 
                 WHERE pilot_id = ? AND archived = 0
                 ORDER BY purchased_at DESC`,
                [pilot.pilot_id],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });

        // Combine and sort all purchases by date
        const allPurchases = [...marketplacePurchases, ...ticketPurchases]
            .sort((a, b) => new Date(b.purchased_at) - new Date(a.purchased_at));

        console.log(`Purchases API - pilot: ${pilot.pilot_id}, marketplace: ${marketplacePurchases.length}, tickets: ${ticketPurchases.length}, total: ${allPurchases.length}`);
        
        res.json({ purchases: allPurchases });
    } catch (err) {
        console.error('Error fetching purchases:', err);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

/**
 * GET /api/rewards/wallet
 * Get pilot's wallet balance
 */
router.get('/wallet', authenticateUser, async (req, res) => {
    try {
        // First, find the pilot_id using the Supabase user ID
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            return res.json({ 
                usdt_balance: 0, 
                usdt_pending: 0,
                recent_payments: []
            });
        }

        // Get wallet balance
        const balance = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilot_wallet_balances WHERE pilot_id = ?', [pilot.pilot_id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || { usdt_balance: 0, usdt_pending: 0 });
                }
            });
        });

        // Get recent payments
        const payments = await new Promise((resolve, reject) => {
            req.db.all(`
                SELECT payment_id, transaction_hash, payment_amount, payment_currency, 
                       payment_status, created_at, verification_error
                FROM wallet_payments 
                WHERE pilot_id = ? 
                ORDER BY created_at DESC 
                LIMIT 10
            `, [pilot.pilot_id], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        res.json({
            usdt_balance: balance.usdt_balance || 0,
            usdt_pending: balance.usdt_pending || 0,
            recent_payments: payments
        });
    } catch (err) {
        console.error('Error fetching wallet:', err);
        res.status(500).json({ error: 'Failed to fetch wallet data' });
    }
});

/**
 * POST /api/rewards/wallet/payment
 * Submit a wallet payment with transaction hash
 */
router.post('/wallet/payment', authenticateUser, async (req, res) => {
    try {
        const { transaction_hash, payment_amount, description } = req.body;

        if (!transaction_hash || !payment_amount) {
            return res.status(400).json({ error: 'Transaction hash and payment amount are required' });
        }

        // Validate transaction hash format
        if (!/^0x([0-9a-fA-F]{64})$/.test(transaction_hash.trim())) {
            return res.status(400).json({ error: 'Invalid transaction hash format' });
        }

        // Validate payment amount
        const amount = parseFloat(payment_amount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid payment amount' });
        }

        // Find pilot_id
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            return res.status(400).json({ error: 'Pilot profile not found' });
        }

        // Check if transaction hash already exists
        const existingPayment = await new Promise((resolve, reject) => {
            req.db.get('SELECT payment_id FROM wallet_payments WHERE transaction_hash = ?', [transaction_hash.trim()], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (existingPayment) {
            return res.status(400).json({ error: 'Transaction hash already submitted' });
        }

        // Create payment record
        const paymentId = uuidv4();
        await new Promise((resolve, reject) => {
            req.db.run(`
                INSERT INTO wallet_payments (
                    payment_id, pilot_id, transaction_hash, payment_amount, 
                    payment_currency, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?)
            `, [paymentId, pilot.pilot_id, transaction_hash.trim(), amount, 'USDT', 'pending'], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID });
                }
            });
        });

        res.json({ 
            success: true, 
            message: 'Payment submitted for verification',
            payment_id: paymentId
        });
    } catch (err) {
        console.error('Error submitting payment:', err);
        res.status(500).json({ error: 'Failed to submit payment' });
    }
});

/**
 * POST /api/rewards/wallet/buy-points
 * Buy points using wallet balance
 */
router.post('/wallet/buy-points', authenticateUser, async (req, res) => {
    try {
        const { usdt_amount } = req.body;

        if (!usdt_amount) {
            return res.status(400).json({ error: 'USDT amount is required' });
        }

        const amount = parseFloat(usdt_amount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Invalid USDT amount' });
        }

        // Find pilot_id
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            return res.status(400).json({ error: 'Pilot profile not found' });
        }

        // Check wallet balance
        const balance = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilot_wallet_balances WHERE pilot_id = ?', [pilot.pilot_id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || { usdt_balance: 0 });
                }
            });
        });

        if (balance.usdt_balance < amount) {
            return res.status(400).json({ error: 'Insufficient wallet balance' });
        }

        // Calculate points (1 USDT = 100 points)
        const pointsToAdd = Math.floor(amount * 100);

        // Start transaction
        // 1. Deduct USDT from wallet
        await new Promise((resolve, reject) => {
            req.db.run(`
                UPDATE pilot_wallet_balances 
                SET usdt_balance = usdt_balance - ?, updated_at = CURRENT_TIMESTAMP 
                WHERE pilot_id = ?
            `, [amount, pilot.pilot_id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });

        // 2. Add points
        await new Promise((resolve, reject) => {
            req.db.run(`
                UPDATE pilot_points 
                SET current_points = current_points + ?, 
                    lifetime_earned = lifetime_earned + ?, 
                    updated_at = CURRENT_TIMESTAMP 
                WHERE pilot_id = ?
            `, [pointsToAdd, pointsToAdd, pilot.pilot_id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });

        // 3. Record transaction
        await new Promise((resolve, reject) => {
            req.db.run(`
                INSERT INTO point_transactions (pilot_id, amount, transaction_type, reference_type, reference_id, description) 
                VALUES (?, ?, ?, ?, ?, ?)
            `, [pilot.pilot_id, pointsToAdd, 'earned', 'wallet_purchase', uuidv4(), `Purchased ${pointsToAdd} points for ${amount} USDT`], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID });
                }
            });
        });

        res.json({ 
            success: true, 
            message: `Successfully purchased ${pointsToAdd} points for ${amount} USDT`,
            points_purchased: pointsToAdd,
            usdt_spent: amount
        });
    } catch (err) {
        console.error('Error buying points:', err);
        res.status(500).json({ error: 'Failed to purchase points' });
    }
});

/**
 * GET /api/rewards/achievements/mine
 * Get pilot's achievements and progress
 */
router.get('/achievements/mine', authenticateUser, async (req, res) => {
    console.log('🏆 Achievements/mine API called for user:', req.user.id);
    try {
        if (!req.supabaseAdmin) {
            console.warn('⚠️  Supabase not configured, returning empty achievements');
            return res.json({ achievements: [] });
        }

        // First, find the pilot_id using the Supabase user ID
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            console.log('🏆 No pilot found for user:', req.user.id);
            return res.json({ achievements: [] });
        }
        
        console.log('🏆 Found pilot:', pilot.pilot_id);

        // Get all achievements from Supabase database
        const { data: supabaseAchievements, error } = await req.supabaseAdmin
            .from('achievements')
            .select(`
                *,
                unlock_item:marketplace_items(name)
            `)
            .order('tier', { ascending: true });
            
        if (error) {
            console.error('🏆 Error fetching achievements from Supabase:', error);
            return res.json({ achievements: [] });
        }

        // Get pilot's unlocked achievements from SQLite
        let pilotAchievements = [];
        try {
            pilotAchievements = await new Promise((resolve, reject) => {
                req.db.all(
                    'SELECT achievement_id, unlocked_at, progress FROM pilot_achievements WHERE pilot_id = ?',
                    [pilot.pilot_id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });
        } catch (err) {
            console.error('🏆 Error fetching pilot achievements from SQLite:', err);
        }

        // Create lookup map for pilot achievements
        const pilotAchievementMap = {};
        pilotAchievements.forEach(pa => {
            pilotAchievementMap[pa.achievement_id] = {
                unlocked_at: pa.unlocked_at,
                progress: pa.progress
            };
        });

        // Combine achievements with pilot unlock status
        const achievements = supabaseAchievements?.map(a => {
            const pilotStatus = pilotAchievementMap[a.achievement_id];
            return {
                ...a,
                unlock_item_name: a.unlock_item?.name || null,
                unlocked_at: pilotStatus?.unlocked_at || null,
                progress: pilotStatus?.progress || null,
                unlocked: !!pilotStatus?.unlocked_at
            };
        }) || [];

        console.log('🏆 Raw pilot achievements from SQLite:', pilotAchievements.map(a => ({ 
            id: a.achievement_id, 
            unlocked_at: a.unlocked_at 
        })));

        const unlockedCount = achievements.filter(a => a.unlocked).length;
        console.log('🏆 Returning achievements/mine:', achievements.length, 'total, unlocked:', unlockedCount);
        res.json({ achievements });
    } catch (err) {
        console.error('🏆 Error fetching achievements:', err);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});

/**
 * POST /api/rewards/points/buy
 * Buy points with USDT from wallet balance
 */
router.post('/points/buy', authenticateUser, async (req, res) => {
    try {
        const { usdt_amount } = req.body;

        if (!usdt_amount || usdt_amount <= 0) {
            return res.status(400).json({ error: 'Invalid USDT amount' });
        }

        const EXCHANGE_RATE = 100; // 100 points per USDT
        const points_received = Math.floor(usdt_amount * EXCHANGE_RATE);

        // Get pilot from SQLite
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT pilot_id FROM pilots WHERE supabase_user_id = ?', [req.user.id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!pilot) {
            return res.status(404).json({ error: 'Pilot profile not found' });
        }

        // Check wallet balance
        const walletBalance = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilot_wallet_balances WHERE pilot_id = ?', [pilot.pilot_id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || { usdt_balance: 0 });
                }
            });
        });

        if (walletBalance.usdt_balance < usdt_amount) {
            return res.status(400).json({ 
                error: 'Insufficient wallet balance', 
                required: usdt_amount,
                available: walletBalance.usdt_balance || 0
            });
        }

        // Deduct USDT from wallet and add points
        await new Promise((resolve, reject) => {
            req.db.serialize(() => {
                req.db.run('BEGIN TRANSACTION');
                
                // Update wallet balance
                req.db.run(`
                    UPDATE pilot_wallet_balances 
                    SET usdt_balance = usdt_balance - ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pilot_id = ?
                `, [usdt_amount, pilot.pilot_id], function(err) {
                    if (err) {
                        req.db.run('ROLLBACK');
                        return reject(err);
                    }
                });

                // Update or create pilot points
                req.db.run(`
                    INSERT OR REPLACE INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent, updated_at)
                    VALUES (?, 
                        COALESCE((SELECT current_points FROM pilot_points WHERE pilot_id = ?), 0) + ?,
                        COALESCE((SELECT lifetime_earned FROM pilot_points WHERE pilot_id = ?), 0) + ?,
                        COALESCE((SELECT total_spent FROM pilot_points WHERE pilot_id = ?), 0),
                        CURRENT_TIMESTAMP)
                `, [pilot.pilot_id, pilot.pilot_id, points_received, pilot.pilot_id, points_received, pilot.pilot_id], function(err) {
                    if (err) {
                        req.db.run('ROLLBACK');
                        return reject(err);
                    }
                });

                // Record transaction
                req.db.run(`
                    INSERT INTO point_transactions (pilot_id, amount, transaction_type, reference_type, description, created_at)
                    VALUES (?, ?, 'usdt_purchase', 'wallet', 'Purchased with USDT from wallet balance', CURRENT_TIMESTAMP)
                `, [pilot.pilot_id, points_received], function(err) {
                    if (err) {
                        req.db.run('ROLLBACK');
                        return reject(err);
                    }

                    req.db.run('COMMIT', (err) => {
                        if (err) {
                            req.db.run('ROLLBACK');
                            return reject(err);
                        }
                        resolve({ success: true });
                    });
                });
            });
        });

        // Check for achievements based on USDT spending
        await checkAchievements(req.db, pilot.pilot_id, 'usdt_purchase', { usdt_amount, points_received });

        res.json({ 
            success: true, 
            points_received,
            usdt_spent: usdt_amount,
            exchange_rate: EXCHANGE_RATE,
            message: `Successfully purchased ${points_received} points for ${usdt_amount} USDT`
        });
    } catch (err) {
        console.error('Error buying points:', err);
        res.status(500).json({ error: 'Failed to purchase points' });
    }
});

/**
 * POST /api/rewards/wallet/payment
 * Submit a wallet payment for verification
 */
router.post('/wallet/payment', authenticateUser, async (req, res) => {
    try {
        const { amount, transaction_hash, description, currency = 'USDT' } = req.body;

        if (!amount || !transaction_hash) {
            return res.status(400).json({ error: 'Amount and transaction hash are required' });
        }

        if (amount <= 0) {
            return res.status(400).json({ error: 'Amount must be greater than 0' });
        }

        // Get pilot profile for wallet address
        const { data: profile } = await req.supabaseAdmin
            .from('pilot_profiles')
            .select('wallet_address')
            .eq('pilot_id', req.user.id)
            .single();

        // Create payment record
        const { data: payment, error: paymentError } = await req.supabaseAdmin
            .from('usdt_point_purchases')
            .insert({
                pilot_id: req.user.id,
                usdt_amount: amount,
                points_received: 0, // Will be calculated after verification
                exchange_rate: 100,
                wallet_address: profile?.wallet_address,
                transaction_hash: transaction_hash,
                status: 'pending',
                description: description || 'Wallet payment'
            })
            .select()
            .single();

        if (paymentError) throw paymentError;

        res.json({
            success: true,
            message: 'Payment submitted for verification',
            transaction_id: payment.transaction_id
        });
    } catch (err) {
        console.error('Error submitting payment:', err);
        res.status(500).json({ error: 'Failed to submit payment' });
    }
});

/**
 * Helper function to check and award achievements based on pilot activity
 */
async function checkAchievements(db, pilotId, eventType, eventData = {}) {
    try {
        // Get pilot's current stats
        const pilotStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    pp.current_points,
                    pp.lifetime_earned,
                    pp.total_spent,
                    COUNT(DISTINCT pa.achievement_id) as achievement_count
                FROM pilot_points pp
                LEFT JOIN pilot_achievements pa ON pp.pilot_id = pa.pilot_id
                WHERE pp.pilot_id = ?
                GROUP BY pp.pilot_id
            `, [pilotId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row || { current_points: 0, lifetime_earned: 0, total_spent: 0, achievement_count: 0 });
                }
            });
        });

        // Get achievements that could be triggered by this event
        const eligibleAchievements = await new Promise((resolve, reject) => {
            db.all(`
                SELECT a.*
                FROM achievements a
                LEFT JOIN pilot_achievements pa ON a.achievement_id = pa.achievement_id AND pa.pilot_id = ?
                WHERE a.is_active = 1 AND pa.pilot_id IS NULL
            `, [pilotId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Check each achievement
        for (const achievement of eligibleAchievements) {
            let shouldAward = false;
            const requirements = achievement.requirement_value ? JSON.parse(achievement.requirement_value) : {};

            switch (achievement.requirement_type) {
                case 'lifetime_points':
                    if (pilotStats.lifetime_earned >= requirements.threshold) {
                        shouldAward = true;
                    }
                    break;

                case 'points_spent':
                    if (pilotStats.total_spent >= requirements.threshold) {
                        shouldAward = true;
                    }
                    break;

                case 'manual_trigger':
                    if (eventType === requirements.trigger_type) {
                        shouldAward = true;
                    }
                    break;

                default:
                    // Future achievement types can be added here
                    break;
            }

            if (shouldAward) {
                // Award the achievement
                await new Promise((resolve, reject) => {
                    db.run(`
                        INSERT INTO pilot_achievements (pilot_id, achievement_id, progress)
                        VALUES (?, ?, ?)
                    `, [pilotId, achievement.achievement_id, JSON.stringify({ triggered_by: eventType, event_data: eventData })], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ lastID: this.lastID });
                        }
                    });
                });

                // Award points if specified
                if (achievement.points_reward > 0) {
                    await awardPoints(db, pilotId, achievement.points_reward, 'achievement', achievement.achievement_id, `Achievement: ${achievement.name}`);
                }

                // Unlock item if specified
                if (achievement.unlock_item_id) {
                    await new Promise((resolve, reject) => {
                        db.run(`
                            INSERT OR IGNORE INTO pilot_unlocked_items (pilot_id, item_id, unlocked_by, reference_id)
                            VALUES (?, ?, 'achievement', ?)
                        `, [pilotId, achievement.unlock_item_id, achievement.achievement_id], function(err) {
                            if (err) {
                                reject(err);
                            } else {
                                resolve({ lastID: this.lastID });
                            }
                        });
                    });

                    console.log(`Item "${achievement.unlock_item_id}" unlocked for pilot ${pilotId} via achievement "${achievement.name}"`);
                }

                console.log(`Achievement "${achievement.name}" awarded to pilot ${pilotId}`);
            }
        }

        return true;
    } catch (err) {
        console.error('Error checking achievements:', err);
        return false;
    }
}

/**
 * Helper function to award points
 */
async function awardPoints(db, pilotId, amount, referenceType, referenceId, description = null) {
    // Get or create pilot points record in SQLite
    let pilotPoints = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM pilot_points WHERE pilot_id = ?', [pilotId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });

    if (!pilotPoints) {
        // Create new pilot points record
        await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent) VALUES (?, ?, ?, ?)',
                [pilotId, amount, amount, 0],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        pilotPoints = {
            pilot_id: pilotId,
            current_points: amount,
            lifetime_earned: amount,
            total_spent: 0
        };
    } else {
        // Update existing pilot points
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE pilot_points SET current_points = current_points + ?, lifetime_earned = lifetime_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE pilot_id = ?',
                [amount, amount, pilotId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        pilotPoints.current_points += amount;
        pilotPoints.lifetime_earned += amount;
    }

    // Record transaction in SQLite
    await new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO point_transactions (pilot_id, amount, transaction_type, reference_type, reference_id, description) VALUES (?, ?, ?, ?, ?, ?)',
            [pilotId, amount, 'earned', referenceType, referenceId, description || `Earned ${amount} points`],
            function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID });
                }
            }
        );
    });

    return true;
}

/**
 * POST /api/tickets/purchase
 * Purchase a race ticket
 */
router.post('/tickets/purchase', authenticateUser, async (req, res) => {
    try {
        const {
            ticket_type,
            pilot_name,
            event_name,
            event_date,
            payment_amount,
            payment_currency,
            payment_reference,
            package_id,
            wallet_address
        } = req.body;

        // Validate required fields
        if (!pilot_name || !event_name || !payment_reference || !payment_amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (payment_amount <= 0) {
            return res.status(400).json({ error: 'Payment amount must be greater than 0' });
        }

        // Get pilot profile for wallet address if not provided
        let finalWalletAddress = wallet_address;
        if (!finalWalletAddress) {
            const { data: profile } = await req.supabaseAdmin
                .from('pilot_profiles')
                .select('wallet_address')
                .eq('pilot_id', req.user.id)
                .single();

            finalWalletAddress = profile?.wallet_address;
        }

        // Generate ticket ID and create ticket purchase record in SQLite
        const ticketId = uuidv4();

        // Get package details if package_id provided
        let packageInfo = { label: null, minutes: 0 };
        if (package_id) {
            // Use MINUTE_PACKAGES from server config
            const minutePackages = [
                { id: 'PKG-S10', label: 'Sprint 10 minutos', minutes: 10 },
                { id: 'PKG-S20', label: 'Endurance 20 minutos', minutes: 20 },
                { id: 'PKG-S30', label: 'Maratona 30 minutos', minutes: 30 }
            ];
            const pkg = minutePackages.find(p => p.id === package_id);
            if (pkg) {
                packageInfo = {
                    label: pkg.label || `${pkg.minutes} min Race Ticket`,
                    minutes: pkg.minutes
                };
            }
        }

        // Create ticket purchase record in SQLite
        const { data: ticket, error: ticketError } = await new Promise((resolve, reject) => {
            const query = `
                INSERT INTO tickets (
                    ticket_id, pilot_id, pilot_name, ticket_type, payment_currency, payment_amount,
                    payment_reference, payment_status, event_name, event_date,
                    package_id, package_label, package_minutes, purchased_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `;

            const params = [
                ticketId,
                req.user.id,
                pilot_name, // Add pilot_name to the parameters
                ticket_type || 'race-pass',
                payment_currency || 'USDT',
                payment_amount,
                payment_reference,
                'pending',
                event_name,
                event_date || null,
                package_id || null,
                packageInfo.label,
                packageInfo.minutes
            ];

            req.db.run(query, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    // Get the created record
                    req.db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId], (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ data: row, error: null });
                        }
                    });
                }
            });
        });

        if (ticketError) {
            console.error('Ticket purchase error:', ticketError);
            return res.status(500).json({ error: 'Failed to submit ticket purchase' });
        }

        res.json({
            success: true,
            message: 'Ticket submitted successfully! Payment will be verified by race control.',
            ticket_id: ticket.ticket_id
        });
    } catch (err) {
        console.error('Error processing ticket purchase:', err);
        res.status(500).json({ error: 'Failed to process ticket purchase' });
    }
});
/**
 * GET /api/rewards/wallet
 * Get pilot's USDT wallet information
 */
router.get('/wallet', authenticateUser, async (req, res) => {
    try {
        // Get pilot profile for wallet address
        const { data: profile } = await req.supabaseAdmin
            .from('pilot_profiles')
            .select('wallet_address')
            .eq('pilot_id', req.user.id)
            .single();

        // Get wallet balance (mock implementation - in real app would check blockchain)
        const balance = 0.0; // This would be fetched from blockchain

        // Get recent transactions
        const { data: transactions } = await req.supabaseAdmin
            .from('usdt_point_purchases')
            .select('*')
            .eq('pilot_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({
            balance,
            wallet_address: profile?.wallet_address || null,
            transactions: transactions || []
        });
    } catch (err) {
        console.error('Error fetching wallet data:', err);
        res.status(500).json({ error: 'Failed to fetch wallet data' });
    }
});

module.exports = { router, awardPoints, checkAchievements };

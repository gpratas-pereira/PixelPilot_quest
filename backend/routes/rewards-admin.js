/**
 * FPVue Rewards System Admin API Routes
 * Handles admin-facing rewards management endpoints
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// Helper function to convert tier string to numeric value
function getTierValue(tier) {
    if (typeof tier === 'number') return tier;
    if (!tier) return 1; // Default to bronze if not specified
    
    const tierMap = {
        'bronze': 1,
        'silver': 2,
        'gold': 3,
        'platinum': 4,
        'diamond': 5
    };
    
    return tierMap[tier.toLowerCase()] || 1;
}

function createValidationError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function parseMetadataInput(rawMetadata) {
    if (rawMetadata === undefined || rawMetadata === null || rawMetadata === '') {
        return {};
    }

    if (typeof rawMetadata === 'string') {
        if (!rawMetadata.trim()) {
            return {};
        }

        try {
            return JSON.parse(rawMetadata);
        } catch (err) {
            throw createValidationError('Metadata must be valid JSON');
        }
    }

    if (typeof rawMetadata === 'object') {
        return rawMetadata;
    }

    throw createValidationError('Metadata must be an object or JSON string');
}

async function ensureVehicleExists(supabaseClient, vehicleId) {
    const trimmedId = typeof vehicleId === 'string' ? vehicleId.trim() : '';

    if (!trimmedId) {
        throw createValidationError('Vehicle ID is required when item type is "vehicle"');
    }

    const { data, error } = await supabaseClient
        .from('vehicles')
        .select('vehicle_id')
        .eq('vehicle_id', trimmedId)
        .limit(1);

    if (error) {
        throw error;
    }

    if (!data || data.length === 0) {
        throw createValidationError(`Vehicle "${trimmedId}" does not exist`);
    }

    return trimmedId;
}

// Middleware to verify any authenticated user (non-admin)
async function authenticateUser(req, res, next) {
    if (!req.supabaseUser) {
        return res.status(401).json({ error: 'Supabase authentication required' });
    }

    req.user = req.supabaseUser;
    next();
}

// Middleware to verify admin user
async function authenticateAdmin(req, res, next) {
    if (!req.supabaseUser) {
        return res.status(401).json({ error: 'Supabase authentication required' });
    }

    const groups = Array.isArray(req.userGroups) ? req.userGroups : [];
    const hasGroup = typeof req.hasGroup === 'function'
        ? req.hasGroup('rewards_admin')
        : groups.includes('rewards_admin');

    if (!hasGroup) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }

    req.user = req.supabaseUser;
    next();
}

/**
 * GET /api/admin/rewards/items
 * Get all marketplace items
 */
router.get('/items', authenticateUser, async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('marketplace_items')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        console.log(`ðŸ”§ Admin items API returning ${(data || []).length} items`);
        console.log('ðŸ”§ Admin items:', (data || []).map(i => ({ id: i.item_id, name: i.name, type: i.item_type })));
        res.json({ items: data || [] });
    } catch (err) {
        console.error('Error fetching items:', err);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

/**
 * POST /api/admin/rewards/items
 * Create a new marketplace item
 */
router.post('/items', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, item_type, points_price, usdt_price, stock, is_active, is_locked, metadata } = req.body;

        if (!name || !item_type) {
            return res.status(400).json({ error: 'Name and item_type are required' });
        }

        if (!points_price && !usdt_price) {
            return res.status(400).json({ error: 'At least one price (points or USDT) is required' });
        }

        let parsedMetadata;
        try {
            parsedMetadata = parseMetadataInput(metadata);
        } catch (err) {
            return res.status(err.status || 400).json({ error: err.message });
        }

        if (item_type === 'vehicle') {
            const vehicleIdCandidate = typeof req.body.vehicle_id === 'string'
                ? req.body.vehicle_id
                : parsedMetadata.vehicle_id;

            const vehicleId = await ensureVehicleExists(req.supabaseAdmin, vehicleIdCandidate);
            parsedMetadata = { ...parsedMetadata, vehicle_id: vehicleId };
        } else if (parsedMetadata && typeof parsedMetadata === 'object' && 'vehicle_id' in parsedMetadata) {
            parsedMetadata = { ...parsedMetadata };
            delete parsedMetadata.vehicle_id;
        }

        const { data, error } = await req.supabaseAdmin
            .from('marketplace_items')
            .insert({
                name,
                description,
                item_type,
                points_price: points_price || null,
                usdt_price: usdt_price || null,
                stock: stock ?? -1,
                is_active: is_active ?? true,
                is_locked: is_locked ?? false,
                metadata: parsedMetadata || {}
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ item: data });
    } catch (err) {
        console.error('Error creating item:', err);
        if (err.status) {
            res.status(err.status).json({ error: err.message });
        } else {
            res.status(500).json({ error: 'Failed to create item' });
        }
    }
});

/**
 * PUT /api/admin/rewards/items/:id
 * Update a marketplace item
 */
router.put('/items/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, item_type, points_price, usdt_price, stock, is_active, is_locked, metadata } = req.body;

        console.log('ðŸ› DEBUG - PUT request body:', JSON.stringify(req.body, null, 2));
        console.log('ðŸ› DEBUG - is_locked value received:', is_locked, typeof is_locked);

        const { data: existingItem, error: existingError } = await req.supabaseAdmin
            .from('marketplace_items')
            .select('item_type, metadata')
            .eq('item_id', id)
            .single();

        if (existingError) {
            if (existingError.code === 'PGRST116' || existingError.details?.includes('Row not found')) {
                return res.status(404).json({ error: 'Marketplace item not found' });
            }
            throw existingError;
        }

        const existingMetadata = (existingItem?.metadata && typeof existingItem.metadata === 'object')
            ? existingItem.metadata
            : {};
        const metadataProvided = metadata !== undefined;

        let parsedMetadata;
        try {
            parsedMetadata = metadataProvided
                ? parseMetadataInput(metadata)
                : { ...existingMetadata };
        } catch (err) {
            return res.status(err.status || 400).json({ error: err.message });
        }

        const resolvedItemType = item_type !== undefined ? item_type : existingItem.item_type;

        if (resolvedItemType === 'vehicle') {
            const vehicleIdCandidate = typeof req.body.vehicle_id === 'string'
                ? req.body.vehicle_id
                : parsedMetadata.vehicle_id || existingMetadata.vehicle_id;

            const vehicleId = await ensureVehicleExists(req.supabaseAdmin, vehicleIdCandidate);
            parsedMetadata = { ...parsedMetadata, vehicle_id: vehicleId };
        } else if (parsedMetadata && typeof parsedMetadata === 'object' && 'vehicle_id' in parsedMetadata) {
            parsedMetadata = { ...parsedMetadata };
            delete parsedMetadata.vehicle_id;
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (item_type !== undefined) updateData.item_type = item_type;
        if (points_price !== undefined) updateData.points_price = points_price || null;
        if (usdt_price !== undefined) updateData.usdt_price = usdt_price || null;
        if (stock !== undefined) updateData.stock = stock;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (is_locked !== undefined) updateData.is_locked = is_locked;
        updateData.metadata = parsedMetadata || {};
        
        console.log('ðŸ› DEBUG - updateData prepared:', JSON.stringify(updateData, null, 2));

        const { data, error } = await req.supabaseAdmin
            .from('marketplace_items')
            .update(updateData)
            .eq('item_id', id)
            .select()
            .single();

        if (error) {
            console.log('ðŸ› DEBUG - Database update error:', error);
            throw error;
        }

        console.log('ðŸ› DEBUG - Database update successful, returned data:', JSON.stringify(data, null, 2));
        console.log('ðŸ› DEBUG - Final is_locked value in DB:', data.is_locked);

        res.json({ item: data });
    } catch (err) {
        console.error('Error updating item:', err);
        if (err.status) {
            res.status(err.status).json({ error: err.message });
        } else {
            res.status(500).json({ error: 'Failed to update item' });
        }
    }
});

/**
 * DELETE /api/admin/rewards/items/:id
 * Delete a marketplace item
 */
router.delete('/items/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await req.supabaseAdmin
            .from('marketplace_items')
            .delete()
            .eq('item_id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting item:', err);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

/**
 * GET /api/admin/rewards/achievements
 * Get all achievements
 */
router.get('/achievements', authenticateUser, async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('achievements')
            .select(`
                *,
                unlock_item:marketplace_items(name)
            `)
            .order('tier', { ascending: true });

        if (error) throw error;

        const achievements = data?.map(a => ({
            ...a,
            unlock_item_name: a.unlock_item?.name || null
        })) || [];

        res.json({ achievements });
    } catch (err) {
        console.error('Error fetching achievements:', err);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});

/**
 * POST /api/admin/rewards/achievements
 * Create a new achievement
 */
router.post('/achievements', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, points_reward, unlock_item_id, requirement_type, requirement_value, icon, tier, is_active } = req.body;

        if (!name || !requirement_type || !requirement_value) {
            return res.status(400).json({ error: 'Name, requirement_type, and requirement_value are required' });
        }

        const { data, error } = await req.supabaseAdmin
            .from('achievements')
            .insert({
                name,
                description,
                points_reward: points_reward || 0,
                unlock_item_id: unlock_item_id || null,
                requirement_type,
                requirement_value,
                icon: icon || 'ðŸ†',
                tier: getTierValue(tier) || 1,
                is_active: is_active ?? true
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ achievement: data });
    } catch (err) {
        console.error('Error creating achievement:', err);
        res.status(500).json({ error: 'Failed to create achievement' });
    }
});

/**
 * PUT /api/admin/rewards/achievements/:id
 * Update an existing achievement
 */
router.put('/achievements/:id', authenticateAdmin, async (req, res) => {
    try {
        const achievementId = req.params.id;
        const { name, description, points_reward, unlock_item_id, requirement_type, requirement_value, icon, tier, is_active } = req.body;

        if (!achievementId) {
            return res.status(400).json({ error: 'Achievement ID is required' });
        }

        if (!name || !requirement_type || !requirement_value) {
            return res.status(400).json({ error: 'Name, requirement_type, and requirement_value are required' });
        }

        const { data, error } = await req.supabaseAdmin
            .from('achievements')
            .update({
                name,
                description,
                points_reward: points_reward || 0,
                unlock_item_id: unlock_item_id || null,
                requirement_type,
                requirement_value,
                icon: icon || 'ðŸ†',
                tier: getTierValue(tier) || 1,
                is_active: is_active ?? true,
                updated_at: new Date().toISOString()
            })
            .eq('achievement_id', achievementId)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: 'Achievement not found' });
        }

        res.json({ achievement: data });
    } catch (err) {
        console.error('Error updating achievement:', err);
        res.status(500).json({ error: 'Failed to update achievement' });
    }
});

/**
 * DELETE /api/admin/rewards/achievements/:id
 * Delete an achievement
 */
router.delete('/achievements/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await req.supabaseAdmin
            .from('achievements')
            .delete()
            .eq('achievement_id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting achievement:', err);
        res.status(500).json({ error: 'Failed to delete achievement' });
    }
});

/**
 * GET /api/admin/rewards/rules
 * Get all point rules
 */
router.get('/rules', authenticateAdmin, async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('point_rules')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ rules: data || [] });
    } catch (err) {
        console.error('Error fetching rules:', err);
        res.status(500).json({ error: 'Failed to fetch rules' });
    }
});

/**
 * POST /api/admin/rewards/rules
 * Create a new point rule
 */
router.post('/rules', authenticateAdmin, async (req, res) => {
    try {
        const { event_type, description, points, conditions, is_active } = req.body;

        if (!event_type || !points) {
            return res.status(400).json({ error: 'event_type and points are required' });
        }

        const { data, error } = await req.supabaseAdmin
            .from('point_rules')
            .insert({
                event_type,
                description,
                points,
                conditions: conditions || {},
                is_active: is_active ?? true
            })
            .select()
            .single();

        if (error) throw error;

        res.json({ rule: data });
    } catch (err) {
        console.error('Error creating rule:', err);
        res.status(500).json({ error: 'Failed to create rule' });
    }
});

/**
 * GET /api/admin/rewards/pilots
 * Get all pilots with their points
 */
router.get('/pilots', authenticateAdmin, async (req, res) => {
    try {
        // Get all pilots from SQLite
        const pilots = await new Promise((resolve, reject) => {
            const query = `
                SELECT p.*,
                       COALESCE(pp.current_points, 0) as current_points,
                       COALESCE(pp.lifetime_earned, 0) as lifetime_earned,
                       COALESCE(pp.total_spent, 0) as total_spent
                FROM pilots p
                LEFT JOIN pilot_points pp ON p.pilot_id = pp.pilot_id
                ORDER BY p.created_at DESC
            `;

            req.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Get user emails from Supabase auth
        const pilotIds = pilots.map(p => p.supabase_user_id).filter(Boolean);
        const { data: { users }, error: usersError } = await req.supabaseAdmin.auth.admin.listUsers();

        if (usersError) {
            console.error('Error fetching users:', usersError);
            // Continue without user emails if auth fails
        }

        const userMap = {};
        if (users) {
            users.forEach(user => {
                userMap[user.id] = user.email;
            });
        }

        const pilotsWithDetails = pilots.map(pilot => ({
            pilot_id: pilot.pilot_id,
            email: userMap[pilot.supabase_user_id] || pilot.email || null,
            display_name: pilot.display_name || pilot.email?.split('@')[0] || 'Unknown Pilot',
            vehicle_id: pilot.vehicle_id || null,
            current_points: pilot.current_points || 0,
            lifetime_earned: pilot.lifetime_earned || 0,
            total_spent: pilot.total_spent || 0
        }));

        res.json({ pilots: pilotsWithDetails });
    } catch (err) {
        console.error('Error fetching pilots:', err);
        res.status(500).json({ error: 'Failed to fetch pilots: ' + (err.message || 'Unknown error') });
    }
});

/**
 * POST /api/admin/rewards/award
 * Manually award points to a pilot
 */
router.post('/award', authenticateAdmin, async (req, res) => {
    try {
        const { pilot_id, amount, reason } = req.body;

        if (!pilot_id || !amount || !reason) {
            return res.status(400).json({ error: 'pilot_id, amount, and reason are required' });
        }

        if (amount <= 0) {
            return res.status(400).json({ error: 'Amount must be positive' });
        }

        // Get or create pilot points
        let pilotPoints = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilot_points WHERE pilot_id = ?', [pilot_id], (err, row) => {
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
                req.db.run(
                    'INSERT INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent) VALUES (?, ?, ?, ?)',
                    [pilot_id, amount, amount, 0],
                    function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ changes: this.changes, lastID: this.lastID });
                        }
                    }
                );
            });

            pilotPoints = {
                pilot_id,
                current_points: amount,
                lifetime_earned: amount,
                total_spent: 0
            };
        } else {
            // Update existing pilot points
            await new Promise((resolve, reject) => {
                req.db.run(
                    'UPDATE pilot_points SET current_points = current_points + ?, lifetime_earned = lifetime_earned + ?, updated_at = CURRENT_TIMESTAMP WHERE pilot_id = ?',
                    [amount, amount, pilot_id],
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

        // Record transaction
        await new Promise((resolve, reject) => {
            req.db.run(
                'INSERT INTO point_transactions (pilot_id, amount, transaction_type, reference_type, description) VALUES (?, ?, ?, ?, ?)',
                [pilot_id, amount, 'admin_award', 'admin', reason],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ lastID: this.lastID });
                    }
                }
            );
        });

        res.json({
            success: true,
            message: 'Points awarded successfully',
            new_balance: pilotPoints.current_points
        });
    } catch (err) {
        console.error('Error awarding points:', err);
        res.status(500).json({ error: 'Failed to award points: ' + (err.message || 'Unknown error') });
    }
});

/**
 * GET /api/admin/rewards/vehicles
 * Get all vehicles
 */
router.get('/vehicles', authenticateAdmin, async (req, res) => {
    if (!req.supabaseAdmin) {
        return res.status(500).json({ error: 'Supabase is not configured on the server' });
    }

    try {
        const { data, error } = await req.supabaseAdmin
            .from('vehicles')
            .select('vehicle_id, vehicle_name, vehicle_type, metadata, created_at, updated_at')
            .order('vehicle_id', { ascending: true });

        if (error) {
            throw error;
        }

        res.json({ vehicles: data || [] });
    } catch (err) {
        console.error('Error fetching vehicles:', err);
        res.status(500).json({ error: 'Failed to fetch vehicles' });
    }
});

/**
 * POST /api/admin/rewards/vehicles
 * Create a new vehicle
 */
router.post('/vehicles', authenticateAdmin, async (req, res) => {
    if (!req.supabaseAdmin) {
        return res.status(500).json({ error: 'Supabase is not configured on the server' });
    }

    const rawVehicleId = typeof req.body?.vehicle_id === 'string'
        ? req.body.vehicle_id.trim()
        : '';

    if (!rawVehicleId) {
        return res.status(400).json({ error: 'Vehicle ID is required' });
    }

    if (!/^[A-Za-z0-9_\-:.]+$/.test(rawVehicleId)) {
        return res.status(400).json({
            error: 'Vehicle ID may only contain letters, numbers, "-", "_", ":" or "."'
        });
    }

    const vehicleName = typeof req.body?.vehicle_name === 'string'
        ? req.body.vehicle_name.trim() || null
        : null;

    const vehicleType = typeof req.body?.vehicle_type === 'string'
        ? req.body.vehicle_type.trim() || null
        : null;

    let metadata = {};
    if (req.body?.metadata !== undefined && req.body.metadata !== null && req.body.metadata !== '') {
        if (typeof req.body.metadata === 'string') {
            try {
                metadata = JSON.parse(req.body.metadata);
            } catch (err) {
                return res.status(400).json({ error: 'Metadata must be valid JSON' });
            }
        } else if (typeof req.body.metadata === 'object') {
            metadata = req.body.metadata;
        } else {
            return res.status(400).json({ error: 'Metadata must be an object or JSON string' });
        }
    }

    try {
        const { data, error } = await req.supabaseAdmin
            .from('vehicles')
            .insert({
                vehicle_id: rawVehicleId,
                vehicle_name: vehicleName,
                vehicle_type: vehicleType,
                metadata
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({ error: 'Vehicle ID already exists' });
            }
            throw error;
        }

        res.status(201).json({ vehicle: data });
    } catch (err) {
        console.error('Error creating vehicle:', err);
        res.status(500).json({ error: 'Failed to create vehicle' });
    }
});

/**
 * PUT /api/admin/rewards/vehicles/:vehicleId
 * Update a vehicle
 */
router.put('/vehicles/:vehicleId', authenticateAdmin, async (req, res) => {
    if (!req.supabaseAdmin) {
        return res.status(500).json({ error: 'Supabase is not configured on the server' });
    }

    const { vehicleId } = req.params;
    const updateFields = {};

    if (req.body?.vehicle_name !== undefined) {
        updateFields.vehicle_name = typeof req.body.vehicle_name === 'string'
            ? req.body.vehicle_name.trim() || null
            : null;
    }

    if (req.body?.vehicle_type !== undefined) {
        updateFields.vehicle_type = typeof req.body.vehicle_type === 'string'
            ? req.body.vehicle_type.trim() || null
            : null;
    }

    if (req.body?.metadata !== undefined) {
        if (req.body.metadata === null || req.body.metadata === '') {
            updateFields.metadata = {};
        } else if (typeof req.body.metadata === 'string') {
            try {
                updateFields.metadata = JSON.parse(req.body.metadata);
            } catch (err) {
                return res.status(400).json({ error: 'Metadata must be valid JSON' });
            }
        } else if (typeof req.body.metadata === 'object') {
            updateFields.metadata = req.body.metadata;
        } else {
            return res.status(400).json({ error: 'Metadata must be an object or JSON string' });
        }
    }

    if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    try {
        updateFields.updated_at = new Date().toISOString();

        const { data, error } = await req.supabaseAdmin
            .from('vehicles')
            .update(updateFields)
            .eq('vehicle_id', vehicleId)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Vehicle not found' });
            }
            throw error;
        }

        res.json({ vehicle: data });
    } catch (err) {
        console.error('Error updating vehicle:', err);
        res.status(500).json({ error: 'Failed to update vehicle' });
    }
});

/**
 * DELETE /api/admin/rewards/vehicles/:vehicleId
 * Delete a vehicle
 */
router.delete('/vehicles/:vehicleId', authenticateAdmin, async (req, res) => {
    if (!req.supabaseAdmin) {
        return res.status(500).json({ error: 'Supabase is not configured on the server' });
    }

    const { vehicleId } = req.params;

    try {
        const { data, error } = await req.supabaseAdmin
            .from('vehicles')
            .delete()
            .eq('vehicle_id', vehicleId)
            .select('vehicle_id');

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'Vehicle not found' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting vehicle:', err);
        res.status(500).json({ error: 'Failed to delete vehicle' });
    }
});

/**
 * PUT /api/admin/pilots/:id/vehicle
 * Assign a vehicle to a pilot
 */
router.put('/pilots/:id/vehicle', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { vehicle_id } = req.body;

        // Update vehicle assignment in SQLite
        await new Promise((resolve, reject) => {
            req.db.run(
                `UPDATE pilots SET vehicle_id = ?, updated_at = CURRENT_TIMESTAMP WHERE pilot_id = ?`,
                [vehicle_id || null, id],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        res.json({ success: true, message: 'Vehicle assigned successfully' });
    } catch (err) {
        console.error('Error assigning vehicle:', err);
        res.status(500).json({ error: 'Failed to assign vehicle' });
    }
});

/**
 * GET /api/admin/tickets
 * Get all tickets with pilot information
 */
router.get('/tickets', authenticateAdmin, async (req, res) => {
    try {
        const status = req.query.status || 'all';
        const showArchived = req.query.include_archived === 'true';

        let query = `
            SELECT t.*, p.display_name as pilot_display_name, p.email
            FROM tickets t
            LEFT JOIN pilots p ON t.pilot_id = p.pilot_id
        `;

        const params = [];

        if (status !== 'all') {
            query += ' WHERE t.payment_status = ?';
            params.push(status);
        }

        if (!showArchived) {
            if (status === 'all') {
                query += ' WHERE t.archived = 0';
            } else {
                query += ' AND t.archived = 0';
            }
        }

        query += ' ORDER BY t.purchased_at DESC';

        const tickets = await new Promise((resolve, reject) => {
            req.db.all(query, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Calculate summary
        const summary = tickets.reduce((acc, ticket) => {
            acc.total++;
            acc.byStatus[ticket.payment_status] = (acc.byStatus[ticket.payment_status] || 0) + 1;
            acc.totalAmount += ticket.payment_amount || 0;
            return acc;
        }, {
            total: 0,
            byStatus: {},
            totalAmount: 0
        });

        res.json({ tickets, summary });
    } catch (err) {
        console.error('Error fetching tickets:', err);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

/**
 * PUT /api/admin/rewards/tickets/:id
 * Update ticket status, archive state, or handle admin approvals
 */
router.put('/tickets/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_status, archived, action, reason } = req.body;

        console.log('Admin ticket update - ticketId:', id);
        console.log('Admin ticket update - body:', { payment_status, archived, action, reason });

        // Get ticket details first for admin approval logic
        const ticket = await new Promise((resolve, reject) => {
            req.db.get(`
                SELECT ticket_id, pilot_id, payment_status, verification_error, payment_amount
                FROM tickets 
                WHERE ticket_id = ?
            `, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!ticket) {
            console.log('Ticket not found:', id);
            return res.status(404).json({ error: 'Ticket not found' });
        }

        console.log('Found ticket:', ticket);

        // Handle admin approval actions for failed BSC verifications
        if (action && ['approve', 'reject'].includes(action)) {
            console.log('Processing admin approval action:', action);
            console.log('Ticket status:', ticket.payment_status, 'Verification error:', ticket.verification_error);
            
            if (!['pending', 'failed'].includes(ticket.payment_status) || !ticket.verification_error) {
                console.log('Admin approval rejected - invalid conditions');
                return res.status(400).json({ error: 'Ticket cannot be manually approved/rejected' });
            }
            
            if (action === 'approve') {
                // Mark ticket as paid and clear verification error
                await new Promise((resolve, reject) => {
                    req.db.run(`
                        UPDATE tickets 
                        SET payment_status = 'paid',
                            verification_error = NULL,
                            admin_reason = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE ticket_id = ?
                    `, [reason || 'Approved by admin after verification failure', id], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ changes: this.changes });
                        }
                    });
                });
                
                return res.json({ message: 'Ticket payment approved by admin' });
            } else {
                // Keep as failed status but update admin reason
                await new Promise((resolve, reject) => {
                    req.db.run(`
                        UPDATE tickets 
                        SET admin_reason = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE ticket_id = ?
                    `, [reason || 'Rejected by admin', id], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ changes: this.changes });
                        }
                    });
                });
                
                return res.json({ message: 'Ticket payment rejected by admin' });
            }
        }

        // Handle regular status updates and archive actions
        const updateFields = [];
        const params = [];

        if (payment_status !== undefined) {
            updateFields.push('payment_status = ?');
            params.push(payment_status);
            
            // Clear verification error when manually setting status
            if (payment_status === 'paid') {
                updateFields.push('verification_error = NULL');
            }
        }

        if (archived !== undefined) {
            updateFields.push('archived = ?');
            params.push(archived ? 1 : 0);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);

        await new Promise((resolve, reject) => {
            req.db.run(
                `UPDATE tickets SET ${updateFields.join(', ')} WHERE ticket_id = ?`,
                params,
                function(err) {
                    if (err) {
                        reject(err);
                    } else if (this.changes === 0) {
                        reject(new Error('Ticket not found'));
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        // Get updated ticket
        const updatedTicket = await new Promise((resolve, reject) => {
            req.db.get(`
                SELECT t.*, p.display_name, p.email
                FROM tickets t
                LEFT JOIN pilots p ON t.pilot_id = p.pilot_id
                WHERE t.ticket_id = ?
            `, [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        res.json({
            success: true,
            message: 'Ticket updated successfully',
            ticket: updatedTicket
        });
    } catch (err) {
        console.error('Error updating ticket:', err);
        res.status(500).json({ error: 'Failed to update ticket' });
    }
});

/**
 * GET /api/admin/rewards/devices
 * Get all devices with detailed pilot and assignment information
 */
router.get('/devices', authenticateAdmin, async (req, res) => {
    try {
        const devices = await new Promise((resolve, reject) => {
            req.db.all(`
                SELECT 
                    d.*,
                    p.pilot_id,
                    p.display_name as pilot_display_name,
                    p.email as pilot_email,
                    t.ticket_id,
                    t.event_name as ticket_event_name,
                    t.package_minutes as ticket_package_minutes,
                    json_object(
                        'pilot_id', d.current_pilot_id,
                        'display_name', COALESCE(p.display_name, 
                            json_extract(d.current_assignment, '$.pilot_display_name'),
                            json_extract(d.current_assignment, '$.pilot_name'),
                            d.current_pilot_name,
                            'Unknown Pilot'
                        ),
                        'email', p.email,
                        'ticket_id', d.current_ticket_id,
                        'assigned_at', json_extract(d.current_assignment, '$.assigned_at')
                    ) as current_pilot,
                    json_object(
                        'ticket_id', t.ticket_id,
                        'event_name', t.event_name,
                        'package_minutes', t.package_minutes,
                        'package_label', t.package_label
                    ) as current_ticket
                FROM devices d
                LEFT JOIN pilots p ON d.current_pilot_id = p.pilot_id
                LEFT JOIN tickets t ON d.current_ticket_id = t.ticket_id
                ORDER BY d.last_seen DESC
            `, [], (err, rows) => {
                if (err) {
                    console.error('Database error in devices query:', err);
                    reject(err);
                } else {
                    // Parse the JSON fields
                    const processedRows = (rows || []).map(row => {
                        try {
                            // Parse current_pilot if it's a string
                            if (row.current_pilot && typeof row.current_pilot === 'string') {
                                row.current_pilot = JSON.parse(row.current_pilot);
                            }
                            
                            // Parse current_ticket if it's a string
                            if (row.current_ticket && typeof row.current_ticket === 'string') {
                                row.current_ticket = JSON.parse(row.current_ticket);
                            }
                            
                            // Ensure current_pilot_name is set correctly
                            if (row.current_pilot?.display_name) {
                                row.current_pilot_name = row.current_pilot.display_name;
                            } else if (row.current_pilot_name) {
                                // If we have a current_pilot_name but no display_name in current_pilot
                                if (!row.current_pilot) row.current_pilot = {};
                                row.current_pilot.display_name = row.current_pilot_name;
                            }
                            
                            return row;
                        } catch (e) {
                            console.error('Error parsing device row:', e, row);
                            return row; // Return as-is if there's a parsing error
                        }
                    });
                    
                    resolve(processedRows);
                }
            });
        });

        console.log(`Returning ${devices.length} devices`);
        res.json({ devices });
    } catch (err) {
        console.error('Error fetching devices:', err);
        res.status(500).json({ error: 'Failed to fetch devices' });
    }
});

/**
 * POST /api/admin/rewards/assignments
 * Create pit lane assignment (updated to use device_id instead of device_identifier)
 */
router.post('/assignments', authenticateAdmin, async (req, res) => {
    try {
        console.log('Assignments request body:', req.body);
        const { ticket_id, device_id, notes } = req.body;
        
        if (!ticket_id || !device_id) {
            console.log('Missing required fields - ticket_id:', ticket_id, 'device_id:', device_id);
            return res.status(400).json({ error: 'ticket_id and device_id are required' });
        }
        
        // Verify ticket exists and is paid
        const ticket = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM tickets WHERE ticket_id = ?', [ticket_id], (err, row) => {
                if (err) {
                    console.error('Error fetching ticket:', err);
                    reject(err);
                } else {
                    console.log('Found ticket:', row);
                    resolve(row);
                }
            });
        });

        if (!ticket) {
            console.log('Ticket not found - ticket_id:', ticket_id);
            return res.status(400).json({ error: 'Ticket not found' });
        }

        if (ticket.payment_status !== 'paid') {
            console.log('Ticket not paid - payment_status:', ticket.payment_status);
            return res.status(400).json({ error: 'Ticket is not paid' });
        }

        // Check if device exists
        const device = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM devices WHERE device_id = ? OR mac_address = ?', [device_id, device_id], (err, row) => {
                if (err) {
                    console.error('Error fetching device:', err);
                    reject(err);
                } else {
                    console.log('Found device:', row);
                    resolve(row);
                }
            });
        });

        if (!device) {
            console.log('Device not found - device_id:', device_id);
            return res.status(400).json({ error: 'Device not found' });
        }

        // Generate assignment ID and get pilot info
        const assignmentId = uuidv4();
        const pilotId = ticket.pilot_id || 'unknown_pilot';
        
        // First, try to get pilot info from the pilots table using the ticket's pilot_id
        let pilotName = 'Unknown Pilot';
        let pilotDisplayName = 'Unknown Pilot';
        
        try {
            // Try to get pilot from database
            const pilot = await new Promise((resolve, reject) => {
                req.db.get('SELECT * FROM pilots WHERE pilot_id = ?', [ticket.pilot_id], (err, row) => {
                    if (err) {
                        console.error('Error fetching pilot:', err);
                        reject(err);
                    } else {
                        resolve(row);
                    }
                });
            });

            if (pilot) {
                console.log('Found pilot in database:', pilot);
                pilotName = pilot.display_name || pilot.name || 'Unknown Pilot';
                pilotDisplayName = pilot.display_name || pilot.name || 'Unknown Pilot';
            } else {
                console.log('Pilot not found in database, falling back to ticket data');
                // Fall back to ticket data if pilot not found
                if (ticket.pilot_display_name) {
                    pilotName = ticket.pilot_display_name;
                    pilotDisplayName = ticket.pilot_display_name;
                } else if (ticket.pilot_name) {
                    pilotName = ticket.pilot_name;
                    pilotDisplayName = ticket.pilot_name;
                } else if (ticket.pilot_data) {
                    try {
                        const pilotData = typeof ticket.pilot_data === 'string' ? 
                            JSON.parse(ticket.pilot_data) : ticket.pilot_data;
                        if (pilotData.display_name) {
                            pilotName = pilotData.display_name;
                            pilotDisplayName = pilotData.display_name;
                        } else if (pilotData.name) {
                            pilotName = pilotData.name;
                            pilotDisplayName = pilotData.name;
                        }
                    } catch (e) {
                        console.error('Error parsing pilot_data:', e);
                    }
                }
            }
        } catch (err) {
            console.error('Error getting pilot info:', err);
            // Fall back to ticket data if there was an error
            if (ticket.pilot_display_name) {
                pilotName = ticket.pilot_display_name;
                pilotDisplayName = ticket.pilot_display_name;
            } else if (ticket.pilot_name) {
                pilotName = ticket.pilot_name;
                pilotDisplayName = ticket.pilot_name;
            }
        }
        
        console.log('Using pilot name:', pilotName, 'display name:', pilotDisplayName);
        
        const deviceId = device.device_id || device_id; // Use device.device_id if available, fallback to provided device_id

        console.log('Creating pit lane registration with:', {
            registration_id: assignmentId,
            pilot_id: pilotId,
            device_id: deviceId,
            ticket_id: ticket_id,
            pilot_name: pilotName,
            notes: notes || ''
        });

        // First, create the pit lane registration
        const registrationResult = await new Promise((resolve, reject) => {
            req.db.run(`
                INSERT INTO pit_lane_registrations (
                    registration_id, pilot_id, device_id, ticket_id, 
                    pilot_name, pilot_display_name, notes, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
            `, [
                assignmentId,
                pilotId,
                device_id,
                ticket_id,
                pilotName,
                pilotDisplayName,
                notes || ''
            ], function(err) {
                if (err) {
                    console.error('Error creating pit lane registration:', err);
                    reject(err);
                } else {
                    console.log('Pit lane registration created with ID:', this.lastID);
                    resolve({ lastID: this.lastID });
                }
            });
        });

        // Then, update the device with the current pilot and ticket
        const updateResult = await new Promise((resolve, reject) => {
            req.db.run(`
                UPDATE devices 
                SET current_pilot_id = ?,
                    current_pilot_name = ?,
                    current_ticket_id = ?,
                    updated_at = CURRENT_TIMESTAMP,
                    current_assignment = json_object(
                        'ticket_id', ?,
                        'pilot_id', ?,
                        'pilot_name', ?,
                        'pilot_display_name', ?,
                        'assigned_at', datetime('now')
                    )
                WHERE device_id = ? OR mac_address = ?
            `, [
                pilotId,
                pilotName,
                ticket_id,
                ticket_id,
                pilotId,
                pilotName,
                pilotDisplayName,
                device_id,
                device_id  // Try both device_id and mac_address
            ], function(err) {
                if (err) {
                    console.error('Error updating device:', err);
                    reject(err);
                } else {
                    console.log(`Device ${device_id} updated with pilot ${pilotId}`);
                    resolve({ changes: this.changes });
                }
            });
        });

        // Update the ticket's redeemed status to true
        await new Promise((resolve, reject) => {
            req.db.run(`
                UPDATE tickets 
                SET redeemed = 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE ticket_id = ?
            `, [ticket_id], function(err) {
                if (err) {
                    console.error('Error updating ticket redeemed status:', err);
                    reject(err);
                } else {
                    console.log(`Ticket ${ticket_id} marked as redeemed`);
                    resolve({ changes: this.changes });
                }
            });
        });

        res.json({
            success: true,
            message: 'Pilot assigned to device successfully',
            assignment_id: assignmentId
        });
    } catch (err) {
        console.error('Error creating assignment:', err);
        res.status(500).json({ 
            error: 'Failed to create assignment',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/**
 * GET /api/admin/rewards/assignments
 * Get all pit lane assignments
 */
router.get('/assignments', authenticateAdmin, async (req, res) => {
    try {
        const assignments = await new Promise((resolve, reject) => {
            // First get the basic assignments data
            req.db.all(`
                SELECT 
                    r.registration_id,
                    r.pilot_id,
                    r.device_id,
                    r.ticket_id,
                    r.pilot_name,
                    r.pilot_display_name,
                    r.check_in_time,
                    r.status,
                    r.notes,
                    r.updated_at,
                    r.session_id,
                    r.allocated_minutes,
                    p.display_name as pilot_display_name_from_profile,
                    p.email,
                    t.event_name,
                    t.package_minutes,
                    d.device_name,
                    d.mac_address,
                    -- Updated COALESCE to prioritize p.display_name first, then r.pilot_display_name, then r.pilot_name
                    COALESCE(
                        NULLIF(p.display_name, ''),  -- First try the pilot's profile name
                        NULLIF(r.pilot_display_name, 'Unknown Pilot'),  -- Then try the registration display name
                        NULLIF(r.pilot_name, 'Unknown Pilot'),  -- Then try the registration name
                        'Unknown Pilot'  -- Fallback if all else fails
                    ) as display_name_combined
                FROM pit_lane_registrations r
                LEFT JOIN pilots p ON r.pilot_id = p.pilot_id
                LEFT JOIN tickets t ON r.ticket_id = t.ticket_id
                LEFT JOIN devices d ON r.device_id = d.device_id OR r.device_id = d.mac_address
                ORDER BY r.check_in_time DESC
            `, [], (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    reject(err);
                } else {
                    console.log('Assignments data:', JSON.stringify(rows, null, 2));
                    
                    // Ensure we have all required fields with fallbacks
                    const processedRows = rows.map(row => ({
                        ...row,
                        device_name: row.device_name || row.device_id || 'Unknown device',
                        ticket_type: row.event_name || 'General Admission',
                        session_allocated_minutes: row.allocated_minutes || 0,
                        session_package_label: row.event_name ? `${row.event_name} Package` : 'N/A'
                    }));
                    
                    resolve(processedRows);
                }
            });
        });

        res.json({ assignments });
    } catch (err) {
        console.error('Error fetching assignments:', err);
        res.status(500).json({ error: 'Failed to fetch assignments' });
    }
});

/**
 * PUT /api/admin/rewards/assignments/:id
 * Update assignment status
 */
router.put('/assignments/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        await new Promise((resolve, reject) => {
            req.db.run(
                `UPDATE pit_lane_registrations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE registration_id = ?`,
                [status, id],
                function(err) {
                    if (err) {
                        reject(err);
                    } else if (this.changes === 0) {
                        reject(new Error('Assignment not found'));
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        res.json({
            success: true,
            message: 'Assignment updated successfully'
        });
    } catch (err) {
        console.error('Error updating assignment:', err);
        res.status(500).json({ error: 'Failed to update assignment' });
    }
});

/**
 * GET /api/admin/rewards/purchases
 * Get all marketplace purchases with pilot information
 */
router.get('/purchases', authenticateAdmin, async (req, res) => {
    try {
        const purchases = await new Promise((resolve, reject) => {
            req.db.all(`
                SELECT 
                    mp.*,
                    p.display_name as pilot_display_name,
                    p.email as pilot_email
                FROM marketplace_purchases mp
                LEFT JOIN pilots p ON mp.pilot_id = p.pilot_id
                ORDER BY mp.purchased_at DESC
            `, [], (err, rows) => {
                if (err) {
                    console.error('Database error in purchases query:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Calculate summary
        const summary = purchases.reduce((acc, purchase) => {
            acc.total++;
            acc.byMethod[purchase.payment_method] = (acc.byMethod[purchase.payment_method] || 0) + 1;
            acc.totalPointsSpent += purchase.points_paid || 0;
            acc.totalUsdtSpent += purchase.usdt_paid || 0;
            return acc;
        }, {
            total: 0,
            byMethod: {},
            totalPointsSpent: 0,
            totalUsdtSpent: 0
        });

        res.json({ purchases, summary });
    } catch (err) {
        console.error('Error fetching purchases:', err);
        res.status(500).json({ error: 'Failed to fetch purchases' });
    }
});

/**
 * GET /api/admin/rewards/wallet-payments
 * Get all wallet payments with pilot information for admin review
 */
router.get('/wallet-payments', authenticateAdmin, async (req, res) => {
    try {
        const status = req.query.status || 'all';
        
        let query = `
            SELECT 
                wp.*,
                p.display_name as pilot_display_name,
                p.email as pilot_email
            FROM wallet_payments wp
            LEFT JOIN pilots p ON wp.pilot_id = p.pilot_id
        `;
        
        const params = [];
        
        if (status !== 'all') {
            query += ' WHERE wp.payment_status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY wp.created_at DESC';

        const payments = await new Promise((resolve, reject) => {
            req.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Database error in wallet payments query:', err);
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Calculate summary
        const summary = payments.reduce((acc, payment) => {
            acc.total++;
            acc.byStatus[payment.payment_status] = (acc.byStatus[payment.payment_status] || 0) + 1;
            acc.totalAmount += payment.payment_amount || 0;
            return acc;
        }, {
            total: 0,
            byStatus: {},
            totalAmount: 0
        });

        res.json({ payments, summary });
    } catch (err) {
        console.error('Error fetching wallet payments:', err);
        res.status(500).json({ error: 'Failed to fetch wallet payments' });
    }
});

/**
 * PUT /api/admin/rewards/wallet-payments/:id
 * Approve or reject a wallet payment
 */
router.put('/wallet-payments/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { action, reason } = req.body; // action: 'approve' or 'reject'

        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Must be "approve" or "reject"' });
        }

        // Get the payment details
        const payment = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM wallet_payments WHERE payment_id = ?', [id], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        if (action === 'approve') {
            // Update payment status to admin_approved
            await new Promise((resolve, reject) => {
                req.db.run(`
                    UPDATE wallet_payments 
                    SET payment_status = 'admin_approved',
                        admin_approved = 1,
                        admin_approved_by = ?,
                        admin_approved_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE payment_id = ?
                `, [req.user.email || req.user.id, id], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                });
            });

            // Add to pilot wallet balance
            await new Promise((resolve, reject) => {
                req.db.run(`
                    INSERT OR REPLACE INTO pilot_wallet_balances (pilot_id, usdt_balance, updated_at)
                    VALUES (?, 
                        COALESCE((SELECT usdt_balance FROM pilot_wallet_balances WHERE pilot_id = ?), 0) + ?,
                        CURRENT_TIMESTAMP)
                `, [payment.pilot_id, payment.pilot_id, payment.payment_amount], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                });
            });

            res.json({ 
                success: true, 
                message: `Payment approved and ${payment.payment_amount} USDT added to pilot wallet` 
            });
        } else {
            // Reject payment
            await new Promise((resolve, reject) => {
                req.db.run(`
                    UPDATE wallet_payments 
                    SET payment_status = 'failed',
                        verification_error = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE payment_id = ?
                `, [reason || 'Rejected by admin', id], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                });
            });

            res.json({ 
                success: true, 
                message: 'Payment rejected' 
            });
        }
    } catch (err) {
        console.error('Error updating wallet payment:', err);
        res.status(500).json({ error: 'Failed to update payment' });
    }
});

/**
 * GET /api/admin/rewards/payment-settings
 * Get payment settings (wallet address)
 */
router.get('/payment-settings', authenticateAdmin, async (req, res) => {
    try {
        const setting = await new Promise((resolve, reject) => {
            req.db.get('SELECT value FROM system_settings WHERE key = ?', ['payment.usdt_wallet'], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        res.json({
            wallet_address: setting?.value || ''
        });
    } catch (err) {
        console.error('Error fetching payment settings:', err);
        res.status(500).json({ error: 'Failed to fetch payment settings' });
    }
});

/**
 * PUT /api/admin/rewards/payment-settings
 * Update payment settings (wallet address)
 */
router.put('/payment-settings', authenticateAdmin, async (req, res) => {
    try {
        const { wallet_address } = req.body;

        await new Promise((resolve, reject) => {
            req.db.run(
                `INSERT INTO system_settings (key, value, updated_at)
                 VALUES ('payment.usdt_wallet', ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
                [wallet_address || null],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        res.json({
            success: true,
            message: 'Payment settings updated',
            wallet_address: wallet_address || ''
        });
    } catch (err) {
        console.error('Error updating payment settings:', err);
        res.status(500).json({ error: 'Failed to update payment settings' });
    }
});

/**
 * POINT RULES ENDPOINTS
 */

/**
 * GET /api/admin/rewards/rules
 * Get all point rules
 */
router.get('/rules', authenticateAdmin, async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('point_rules')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ rules: data || [] });
    } catch (err) {
        console.error('Error fetching point rules:', err);
        res.status(500).json({ error: 'Failed to fetch point rules' });
    }
});

/**
 * POST /api/admin/rewards/rules
 * Create a new point rule
 */
router.post('/rules', authenticateAdmin, async (req, res) => {
    try {
        const { event_type, description, points, is_active = true } = req.body;

        // Validate required fields
        if (!event_type || !points) {
            return res.status(400).json({ error: 'Event type and points are required' });
        }

        // Check if a rule with this event_type already exists
        const { data: existingRule, error: checkError } = await req.supabaseAdmin
            .from('point_rules')
            .select('rule_id')
            .eq('event_type', event_type)
            .maybeSingle();

        if (checkError) throw checkError;
        if (existingRule) {
            return res.status(400).json({ error: 'A rule with this event type already exists' });
        }

        // Insert the new rule
        const { data, error } = await req.supabaseAdmin
            .from('point_rules')
            .insert({
                event_type,
                description: description || null,
                points: parseInt(points, 10),
                is_active: !!is_active
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ rule: data });
    } catch (err) {
        console.error('Error creating point rule:', err);
        res.status(500).json({ 
            error: 'Failed to create point rule',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/**
 * PUT /api/admin/rewards/rules/:id
 * Update an existing point rule
 */
router.put('/rules/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { event_type, description, points, is_active } = req.body;

        // Validate required fields
        if (!event_type || points === undefined) {
            return res.status(400).json({ error: 'Event type and points are required' });
        }

        // Update the rule directly without duplicate check for now
        const { data, error } = await req.supabaseAdmin
            .from('point_rules')
            .update({
                event_type,
                description: description || null,
                points: parseInt(points, 10),
                is_active: is_active !== undefined ? !!is_active : undefined,
                updated_at: new Date().toISOString()
            })
            .eq('rule_id', id)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: 'Point rule not found' });
        }

        res.json({ rule: data });
    } catch (err) {
        console.error('Error updating point rule:', err);
        res.status(500).json({ 
            error: 'Failed to update point rule',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

/**
 * DELETE /api/admin/rewards/rules/:id
 * Delete a point rule
 */
router.delete('/rules/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // First, check if the rule exists
        const { data: existingRule, error: checkError } = await req.supabaseAdmin
            .from('point_rules')
            .select('rule_id')
            .eq('rule_id', id)
            .maybeSingle();

        if (checkError) throw checkError;
        if (!existingRule) {
            return res.status(404).json({ error: 'Point rule not found' });
        }

        // Delete the rule
        const { error } = await req.supabaseAdmin
            .from('point_rules')
            .delete()
            .eq('rule_id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting point rule:', err);
        res.status(500).json({ 
            error: 'Failed to delete point rule',
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Get all tickets
router.get('/tickets', authenticateAdmin, async (req, res) => {
    try {
        const { archived } = req.query;
        const includeArchived = archived === 'true';
        
        let whereClause = '';
        if (!includeArchived) {
            whereClause = 'WHERE t.archived = 0';
        }
        
        const tickets = await req.dbAll(`
            SELECT 
                t.ticket_id,
                t.pilot_id,
                t.payment_amount,
                t.payment_currency,
                t.payment_status,
                t.payment_reference,
                t.package_label,
                t.package_minutes,
                t.redeemed,
                t.archived,
                t.verification_attempts,
                t.verification_error,
                datetime(t.purchased_at, 'localtime') as purchased_at_local,
                datetime(t.last_verification_at, 'localtime') as last_verification_at_local,
                p.display_name as pilot_display_name,
                p.email as pilot_email
            FROM tickets t
            LEFT JOIN pilots p ON t.pilot_id = p.pilot_id
            ${whereClause}
            ORDER BY t.purchased_at DESC
        `);
        
        res.json({ tickets });
    } catch (error) {
        console.error('Error fetching tickets:', error);
        res.status(500).json({ error: 'Failed to fetch tickets' });
    }
});

// Update ticket status or archive status
router.put('/tickets/:ticketId', authenticateAdmin, async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { payment_status, archived, action, reason } = req.body;
        
        console.log('Admin ticket update - ticketId:', ticketId);
        console.log('Admin ticket update - body:', { payment_status, archived, action, reason });
        
        // Get ticket details
        const ticket = await new Promise((resolve, reject) => {
            req.db.get(`
                SELECT ticket_id, pilot_id, payment_status, verification_error, payment_amount
                FROM tickets 
                WHERE ticket_id = ?
            `, [ticketId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
        
        if (!ticket) {
            console.log('Ticket not found:', ticketId);
            return res.status(404).json({ error: 'Ticket not found' });
        }
        
        console.log('Found ticket:', ticket);
        
        // Handle admin approval actions for failed BSC verifications
        if (action && ['approve', 'reject'].includes(action)) {
            console.log('Processing admin approval action:', action);
            console.log('Ticket status:', ticket.payment_status, 'Verification error:', ticket.verification_error);
            
            if (!['pending', 'failed'].includes(ticket.payment_status) || !ticket.verification_error) {
                console.log('Admin approval rejected - invalid conditions');
                return res.status(400).json({ error: 'Ticket cannot be manually approved/rejected' });
            }
            
            if (action === 'approve') {
                // Mark ticket as paid and clear verification error
                await new Promise((resolve, reject) => {
                    req.db.run(`
                        UPDATE tickets 
                        SET payment_status = 'paid',
                            verification_error = NULL,
                            admin_reason = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE ticket_id = ?
                    `, [reason || 'Approved by admin after verification failure', ticketId], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ changes: this.changes });
                        }
                    });
                });
                
                res.json({ message: 'Ticket payment approved by admin' });
            } else {
                // Keep as failed status but update admin reason
                await new Promise((resolve, reject) => {
                    req.db.run(`
                        UPDATE tickets 
                        SET admin_reason = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE ticket_id = ?
                    `, [reason || 'Rejected by admin', ticketId], function(err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve({ changes: this.changes });
                        }
                    });
                });
                
                res.json({ message: 'Ticket payment rejected by admin' });
            }
            return;
        }
        
        // Handle regular status updates
        const updates = [];
        const values = [];
        
        if (payment_status && ['pending', 'paid', 'canceled', 'refunded'].includes(payment_status)) {
            updates.push('payment_status = ?');
            values.push(payment_status);
            
            // Clear verification error when manually setting status
            if (payment_status === 'paid') {
                updates.push('verification_error = NULL');
            }
        }
        
        if (archived !== undefined) {
            updates.push('archived = ?');
            values.push(archived ? 1 : 0);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid updates provided' });
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(ticketId);
        
        const updateQuery = `UPDATE tickets SET ${updates.join(', ')} WHERE ticket_id = ?`;
        await req.dbRun(updateQuery, values);
        
        res.json({ message: 'Ticket updated successfully' });
        
    } catch (error) {
        console.error('Error updating ticket:', error);
        res.status(500).json({ error: 'Failed to update ticket' });
    }
});

/**
 * GET /api/admin/rewards/achievements
 * Get all achievements
 */
router.get('/achievements', authenticateAdmin, async (req, res) => {
    try {
        const achievements = await new Promise((resolve, reject) => {
            req.db.all('SELECT * FROM achievements ORDER BY tier ASC, created_at ASC', [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        res.json({ achievements });
    } catch (err) {
        console.error('Error fetching achievements:', err);
        res.status(500).json({ error: 'Failed to fetch achievements' });
    }
});

/**
 * POST /api/admin/rewards/achievements
 * Create a new achievement
 */
router.post('/achievements', authenticateAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            points_reward = 0,
            requirement_type,
            requirement_value = '{}',
            icon = 'ðŸ†',
            tier = 1,
            is_active = true
        } = req.body;

        if (!name || !requirement_type) {
            return res.status(400).json({ error: 'Name and requirement type are required' });
        }

        const achievementId = uuidv4();
        
        await new Promise((resolve, reject) => {
            req.db.run(`
                INSERT INTO achievements (
                    achievement_id, name, description, points_reward, 
                    requirement_type, requirement_value, icon, tier, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                achievementId, name, description, points_reward,
                requirement_type, typeof requirement_value === 'object' ? JSON.stringify(requirement_value) : requirement_value,
                icon, tier, is_active ? 1 : 0
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID });
                }
            });
        });

        res.json({ 
            success: true, 
            message: 'Achievement created successfully',
            achievement_id: achievementId
        });
    } catch (err) {
        console.error('Error creating achievement:', err);
        res.status(500).json({ error: 'Failed to create achievement' });
    }
});

/**
 * POST /api/admin/rewards/achievements/:id/trigger
 * Manually trigger an achievement for a pilot (for testing without lap counter)
 */
router.post('/achievements/:id/trigger', authenticateAdmin, async (req, res) => {
    try {
        const { id: achievementId } = req.params;
        const { pilot_id, reason = 'Manual trigger by admin' } = req.body;

        console.log('ðŸ† Achievement trigger request:', { achievementId, pilot_id, reason });

        if (!pilot_id) {
            return res.status(400).json({ error: 'Pilot ID is required' });
        }

        // Get achievement details from Supabase
        console.log('ðŸ† Fetching achievement from Supabase:', achievementId);
        const { data: achievements, error } = await req.supabaseAdmin
            .from('achievements')
            .select('*')
            .eq('achievement_id', achievementId)
            .eq('is_active', true)
            .single();

        if (error || !achievements) {
            console.error('ðŸ† Achievement lookup error:', error);
            return res.status(404).json({ error: 'Achievement not found or inactive' });
        }

        const achievement = achievements;
        console.log('ðŸ† Found achievement:', achievement.name);

        // Check if pilot exists
        const pilot = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilots WHERE pilot_id = ?', [pilot_id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!pilot) {
            console.error('ðŸ† Pilot not found:', pilot_id);
            return res.status(400).json({ error: 'Pilot not found' });
        }

        console.log('ðŸ† Found pilot:', pilot.display_name || pilot.email);

        // Check if pilot already has this achievement
        const existingAchievement = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM pilot_achievements WHERE pilot_id = ? AND achievement_id = ?', [pilot_id, achievementId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (existingAchievement) {
            return res.status(400).json({ error: 'Pilot already has this achievement' });
        }

        // Award the achievement
        console.log('ðŸ† Inserting achievement into pilot_achievements...');
        await new Promise((resolve, reject) => {
            req.db.run(`
                INSERT INTO pilot_achievements (pilot_id, achievement_id, unlocked_at, progress)
                VALUES (?, ?, CURRENT_TIMESTAMP, ?)
            `, [pilot_id, achievementId, JSON.stringify({ reason, triggered_by: 'admin' })], function(err) {
                if (err) {
                    console.error('ðŸ† Error inserting pilot_achievement:', err);
                    reject(err);
                } else {
                    console.log('ðŸ† Successfully inserted pilot_achievement');
                    resolve({ lastID: this.lastID });
                }
            });
        });

        // Unlock item if specified
        if (achievement.unlock_item_id) {
            console.log('ðŸ† Unlocking item:', achievement.unlock_item_id);
            await new Promise((resolve, reject) => {
                req.db.run(`
                    INSERT OR IGNORE INTO pilot_unlocked_items (pilot_id, item_id, unlocked_by, reference_id)
                    VALUES (?, ?, 'achievement', ?)
                `, [pilot_id, achievement.unlock_item_id, achievementId], function(err) {
                    if (err) {
                        console.error('ðŸ† Error unlocking item:', err);
                        reject(err);
                    } else {
                        console.log('ðŸ† Successfully unlocked item');
                        resolve({ lastID: this.lastID });
                    }
                });
            });
        }

        // Award points if specified
        if (achievement.points_reward > 0) {
            // Update pilot points
            await new Promise((resolve, reject) => {
                req.db.run(`
                    INSERT OR REPLACE INTO pilot_points (pilot_id, current_points, lifetime_earned, total_spent, updated_at)
                    VALUES (?, 
                        COALESCE((SELECT current_points FROM pilot_points WHERE pilot_id = ?), 0) + ?,
                        COALESCE((SELECT lifetime_earned FROM pilot_points WHERE pilot_id = ?), 0) + ?,
                        COALESCE((SELECT total_spent FROM pilot_points WHERE pilot_id = ?), 0),
                        CURRENT_TIMESTAMP)
                `, [pilot_id, pilot_id, achievement.points_reward, pilot_id, achievement.points_reward, pilot_id], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                });
            });

            // Record transaction
            await new Promise((resolve, reject) => {
                req.db.run(`
                    INSERT INTO point_transactions (pilot_id, amount, transaction_type, reference_type, reference_id, description)
                    VALUES (?, ?, 'earned', 'achievement', ?, ?)
                `, [pilot_id, achievement.points_reward, achievementId, `Achievement: ${achievement.name}`], function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ lastID: this.lastID });
                    }
                });
            });
        }

        res.json({ 
            success: true, 
            message: `Achievement "${achievement.name}" awarded successfully`,
            points_awarded: achievement.points_reward
        });
    } catch (err) {
        console.error('ðŸ† Error triggering achievement:', err);
        console.error('ðŸ† Error stack:', err.stack);
        res.status(500).json({ error: 'Failed to trigger achievement' });
    }
});

/**
 * GET /api/admin/rewards/pilot-achievements/:pilotId
 * Get all achievements for a specific pilot
 */
router.get('/pilot-achievements/:pilotId', authenticateAdmin, async (req, res) => {
    try {
        const { pilotId } = req.params;

        const pilotAchievements = await new Promise((resolve, reject) => {
            req.db.all(`
                SELECT a.*, pa.unlocked_at, pa.progress
                FROM achievements a
                LEFT JOIN pilot_achievements pa ON a.achievement_id = pa.achievement_id AND pa.pilot_id = ?
                ORDER BY a.tier ASC, a.created_at ASC
            `, [pilotId], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        res.json({ achievements: pilotAchievements });
    } catch (err) {
        console.error('Error fetching pilot achievements:', err);
        res.status(500).json({ error: 'Failed to fetch pilot achievements' });
    }
});

/**
 * GET /api/admin/rewards/marketplace-items
 * Get all marketplace items for admin management
 */
router.get('/marketplace-items', authenticateAdmin, async (req, res) => {
    try {
        const items = await new Promise((resolve, reject) => {
            req.db.all('SELECT * FROM marketplace_items ORDER BY created_at DESC', [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        // Parse metadata and include achievement info
        const processedItems = await Promise.all(items.map(async (item) => {
            let unlockAchievement = null;
            if (item.unlock_achievement_id) {
                unlockAchievement = await new Promise((resolve, reject) => {
                    req.db.get('SELECT name, description FROM achievements WHERE achievement_id = ?', [item.unlock_achievement_id], (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(row);
                        }
                    });
                });
            }

            return {
                ...item,
                metadata: item.metadata ? JSON.parse(item.metadata) : {},
                is_locked: Boolean(item.is_locked),
                unlock_achievement: unlockAchievement
            };
        }));

        res.json({ items: processedItems });
    } catch (err) {
        console.error('Error fetching marketplace items:', err);
        res.status(500).json({ error: 'Failed to fetch marketplace items' });
    }
});

/**
 * POST /api/admin/rewards/marketplace-items
 * Create a new marketplace item
 */
router.post('/marketplace-items', authenticateAdmin, async (req, res) => {
    try {
        const {
            name,
            description,
            item_type,
            points_price,
            usdt_price,
            stock = -1,
            is_active = true,
            is_locked = false,
            unlock_achievement_id,
            image_url,
            metadata = {}
        } = req.body;

        if (!name || !item_type) {
            return res.status(400).json({ error: 'Name and item type are required' });
        }

        if (!['vehicle', 'feature', 'cosmetic', 'boost'].includes(item_type)) {
            return res.status(400).json({ error: 'Invalid item type' });
        }

        if (is_locked && !unlock_achievement_id) {
            return res.status(400).json({ error: 'Locked items must have an unlock achievement' });
        }

        const itemId = `item-${Date.now()}`;
        
        await new Promise((resolve, reject) => {
            req.db.run(`
                INSERT INTO marketplace_items (
                    item_id, name, description, item_type, points_price, usdt_price,
                    stock, is_active, is_locked, unlock_achievement_id, image_url, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                itemId, name, description, item_type, points_price || null, usdt_price || null,
                stock, is_active ? 1 : 0, is_locked ? 1 : 0, unlock_achievement_id || null, 
                image_url || null, JSON.stringify(metadata)
            ], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID });
                }
            });
        });

        res.json({ 
            success: true, 
            message: 'Marketplace item created successfully',
            item_id: itemId
        });
    } catch (err) {
        console.error('Error creating marketplace item:', err);
        res.status(500).json({ error: 'Failed to create marketplace item' });
    }
});

/**
 * PUT /api/admin/rewards/marketplace-items/:id
 * Update a marketplace item
 */
router.put('/marketplace-items/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id: itemId } = req.params;
        const {
            name,
            description,
            item_type,
            points_price,
            usdt_price,
            stock,
            is_active,
            is_locked,
            unlock_achievement_id,
            image_url,
            metadata
        } = req.body;

        // Check if item exists
        const existingItem = await new Promise((resolve, reject) => {
            req.db.get('SELECT * FROM marketplace_items WHERE item_id = ?', [itemId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });

        if (!existingItem) {
            return res.status(404).json({ error: 'Marketplace item not found' });
        }

        if (is_locked && !unlock_achievement_id) {
            return res.status(400).json({ error: 'Locked items must have an unlock achievement' });
        }

        // Build update query
        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description);
        }
        if (item_type !== undefined) {
            if (!['vehicle', 'feature', 'cosmetic', 'boost'].includes(item_type)) {
                return res.status(400).json({ error: 'Invalid item type' });
            }
            updates.push('item_type = ?');
            values.push(item_type);
        }
        if (points_price !== undefined) {
            updates.push('points_price = ?');
            values.push(points_price);
        }
        if (usdt_price !== undefined) {
            updates.push('usdt_price = ?');
            values.push(usdt_price);
        }
        if (stock !== undefined) {
            updates.push('stock = ?');
            values.push(stock);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            values.push(is_active ? 1 : 0);
        }
        if (is_locked !== undefined) {
            updates.push('is_locked = ?');
            values.push(is_locked ? 1 : 0);
        }
        if (unlock_achievement_id !== undefined) {
            updates.push('unlock_achievement_id = ?');
            values.push(unlock_achievement_id);
        }
        if (image_url !== undefined) {
            updates.push('image_url = ?');
            values.push(image_url);
        }
        if (metadata !== undefined) {
            updates.push('metadata = ?');
            values.push(JSON.stringify(metadata));
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid updates provided' });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(itemId);

        const updateQuery = `UPDATE marketplace_items SET ${updates.join(', ')} WHERE item_id = ?`;
        await new Promise((resolve, reject) => {
            req.db.run(updateQuery, values, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });

        res.json({ 
            success: true, 
            message: 'Marketplace item updated successfully' 
        });
    } catch (err) {
        console.error('Error updating marketplace item:', err);
        res.status(500).json({ error: 'Failed to update marketplace item' });
    }
});

/**
 * DELETE /api/admin/rewards/marketplace-items/:id
 * Delete a marketplace item (soft delete by setting is_active = false)
 */
router.delete('/marketplace-items/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id: itemId } = req.params;

        const result = await new Promise((resolve, reject) => {
            req.db.run(
                'UPDATE marketplace_items SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE item_id = ?',
                [itemId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ changes: this.changes });
                    }
                }
            );
        });

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Marketplace item not found' });
        }

        res.json({ 
            success: true, 
            message: 'Marketplace item deleted successfully' 
        });
    } catch (err) {
        console.error('Error deleting marketplace item:', err);
        res.status(500).json({ error: 'Failed to delete marketplace item' });
    }
});

module.exports = router;


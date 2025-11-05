/**
 * FPVue Rewards System Integration Utilities
 * Helper functions for integrating rewards with session and lap tracking
 */

const { awardPoints } = require('../routes/rewards');

/**
 * Award points when a session completes
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {string} deviceId - Device identifier
 * @param {Object} sessionData - Session data (duration, laps, etc.)
 */
async function onSessionComplete(supabaseAdmin, deviceId, sessionData) {
    try {
        // Get pilot by device ID
        const pilot = await getPilotByDeviceId(supabaseAdmin, deviceId);
        
        if (!pilot) {
            console.log(`No pilot found for device ${deviceId}, skipping points award`);
            return;
        }

        // Get point rule for session completion
        const { data: rule } = await supabaseAdmin
            .from('point_rules')
            .select('points')
            .eq('event_type', 'session_complete')
            .eq('is_active', true)
            .single();

        const points = rule?.points || 50; // Default 50 points

        // Award points
        await awardPoints(
            supabaseAdmin,
            pilot.pilot_id,
            points,
            'session',
            sessionData.session_id,
            `Completed racing session (${sessionData.duration}s)`
        );

        console.log(`✅ Awarded ${points} points to pilot ${pilot.display_name || pilot.pilot_id} for session completion`);

        // Check for first session achievement
        await checkAchievement(supabaseAdmin, pilot.pilot_id, 'session_count', 1);

        // Update session count achievement progress
        await updateAchievementProgress(supabaseAdmin, pilot.pilot_id, 'session_count');

    } catch (err) {
        console.error('Error awarding session completion points:', err);
    }
}

/**
 * Award points when a lap completes
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {string} vehicleId - Vehicle identifier
 * @param {number} lapTime - Lap time in milliseconds
 * @param {Object} lapData - Additional lap data
 */
async function onLapComplete(supabaseAdmin, vehicleId, lapTime, lapData = {}) {
    try {
        // Get pilot by vehicle ID
        const pilot = await getPilotByVehicleId(supabaseAdmin, vehicleId);
        
        if (!pilot) {
            console.log(`No pilot found for vehicle ${vehicleId}, skipping points award`);
            return;
        }

        // Determine points based on lap time
        let points = 0;
        let eventType = null;
        let description = '';

        const lapTimeSeconds = lapTime / 1000;

        if (lapTime < 20000) { // Under 20 seconds
            const { data: rule } = await supabaseAdmin
                .from('point_rules')
                .select('points')
                .eq('event_type', 'lap_sub_20')
                .eq('is_active', true)
                .single();
            
            points = rule?.points || 500;
            eventType = 'lap_sub_20';
            description = `Amazing lap! Under 20s (${lapTimeSeconds.toFixed(2)}s)`;
        } else if (lapTime < 25000) { // Under 25 seconds
            const { data: rule } = await supabaseAdmin
                .from('point_rules')
                .select('points')
                .eq('event_type', 'lap_sub_25')
                .eq('is_active', true)
                .single();
            
            points = rule?.points || 200;
            eventType = 'lap_sub_25';
            description = `Great lap! Under 25s (${lapTimeSeconds.toFixed(2)}s)`;
        } else if (lapTime < 30000) { // Under 30 seconds
            const { data: rule } = await supabaseAdmin
                .from('point_rules')
                .select('points')
                .eq('event_type', 'lap_sub_30')
                .eq('is_active', true)
                .single();
            
            points = rule?.points || 100;
            eventType = 'lap_sub_30';
            description = `Good lap! Under 30s (${lapTimeSeconds.toFixed(2)}s)`;
        }

        // Award points if earned
        if (points > 0) {
            await awardPoints(
                supabaseAdmin,
                pilot.pilot_id,
                points,
                'lap',
                lapData.lap_id || null,
                description
            );

            console.log(`✅ Awarded ${points} points to pilot ${pilot.display_name || pilot.pilot_id} for ${eventType}`);
        }

        // Update lap time achievement progress
        await updateAchievementProgress(supabaseAdmin, pilot.pilot_id, 'lap_time', lapTime);

        // Update total laps achievement progress
        await updateAchievementProgress(supabaseAdmin, pilot.pilot_id, 'total_laps');

    } catch (err) {
        console.error('Error awarding lap completion points:', err);
    }
}

/**
 * Get pilot by device ID
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {string} deviceId - Device identifier
 * @returns {Object|null} Pilot data or null
 */
async function getPilotByDeviceId(supabaseAdmin, deviceId) {
    // This would need to be implemented based on your device-to-pilot mapping
    // For now, return null - you'll need to add a device_id field to pilot_profiles
    // or maintain a separate device_assignments table
    
    // Example implementation:
    // const { data } = await supabaseAdmin
    //     .from('pilot_profiles')
    //     .select('pilot_id, display_name')
    //     .eq('current_device_id', deviceId)
    //     .single();
    
    // return data;
    
    console.log('getPilotByDeviceId not yet implemented - add device-to-pilot mapping');
    return null;
}

/**
 * Get pilot by vehicle ID
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {string} vehicleId - Vehicle identifier
 * @returns {Object|null} Pilot data or null
 */
async function getPilotByVehicleId(supabaseAdmin, vehicleId) {
    try {
        const { data, error } = await supabaseAdmin
            .from('pilot_profiles')
            .select('pilot_id, display_name, vehicle_id')
            .eq('vehicle_id', vehicleId)
            .single();

        if (error) {
            if (error.code !== 'PGRST116') { // Not found error
                console.error('Error fetching pilot by vehicle:', error);
            }
            return null;
        }

        return data;
    } catch (err) {
        console.error('Error in getPilotByVehicleId:', err);
        return null;
    }
}

/**
 * Check if pilot has unlocked an achievement
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {string} pilotId - Pilot ID
 * @param {string} requirementType - Achievement requirement type
 * @param {number} currentValue - Current progress value
 */
async function checkAchievement(supabaseAdmin, pilotId, requirementType, currentValue) {
    try {
        // Get all achievements of this type
        const { data: achievements } = await supabaseAdmin
            .from('achievements')
            .select('*')
            .eq('requirement_type', requirementType)
            .eq('is_active', true);

        if (!achievements || achievements.length === 0) return;

        for (const achievement of achievements) {
            const target = achievement.requirement_value?.target;
            
            if (!target) continue;

            // Check if requirement is met
            if (currentValue >= target) {
                // Check if already unlocked
                const { data: existing } = await supabaseAdmin
                    .from('pilot_achievements')
                    .select('*')
                    .eq('pilot_id', pilotId)
                    .eq('achievement_id', achievement.achievement_id)
                    .single();

                if (!existing) {
                    // Unlock achievement
                    await supabaseAdmin
                        .from('pilot_achievements')
                        .insert({
                            pilot_id: pilotId,
                            achievement_id: achievement.achievement_id,
                            progress: { current: currentValue }
                        });

                    // Award points
                    if (achievement.points_reward > 0) {
                        await awardPoints(
                            supabaseAdmin,
                            pilotId,
                            achievement.points_reward,
                            'achievement',
                            achievement.achievement_id,
                            `Unlocked achievement: ${achievement.name}`
                        );
                    }

                    console.log(`🏆 Pilot ${pilotId} unlocked achievement: ${achievement.name}`);
                }
            }
        }
    } catch (err) {
        console.error('Error checking achievement:', err);
    }
}

/**
 * Update achievement progress
 * @param {Object} supabaseAdmin - Supabase admin client
 * @param {string} pilotId - Pilot ID
 * @param {string} requirementType - Achievement requirement type
 * @param {number} value - New value (optional, will increment by 1 if not provided)
 */
async function updateAchievementProgress(supabaseAdmin, pilotId, requirementType, value = null) {
    try {
        // Get all achievements of this type
        const { data: achievements } = await supabaseAdmin
            .from('achievements')
            .select('*')
            .eq('requirement_type', requirementType)
            .eq('is_active', true);

        if (!achievements || achievements.length === 0) return;

        for (const achievement of achievements) {
            // Get current progress
            let { data: progress } = await supabaseAdmin
                .from('pilot_achievements')
                .select('*')
                .eq('pilot_id', pilotId)
                .eq('achievement_id', achievement.achievement_id)
                .single();

            if (!progress) {
                // Create initial progress
                const initialValue = value !== null ? value : 1;
                
                await supabaseAdmin
                    .from('pilot_achievements')
                    .insert({
                        pilot_id: pilotId,
                        achievement_id: achievement.achievement_id,
                        progress: { current: initialValue },
                        unlocked_at: null
                    });

                // Check if this unlocks the achievement
                await checkAchievement(supabaseAdmin, pilotId, requirementType, initialValue);
            } else if (!progress.unlocked_at) {
                // Update progress if not yet unlocked
                const currentProgress = progress.progress?.current || 0;
                const newProgress = value !== null ? value : currentProgress + 1;

                await supabaseAdmin
                    .from('pilot_achievements')
                    .update({
                        progress: { current: newProgress }
                    })
                    .eq('pilot_id', pilotId)
                    .eq('achievement_id', achievement.achievement_id);

                // Check if this unlocks the achievement
                await checkAchievement(supabaseAdmin, pilotId, requirementType, newProgress);
            }
        }
    } catch (err) {
        console.error('Error updating achievement progress:', err);
    }
}

module.exports = {
    onSessionComplete,
    onLapComplete,
    getPilotByDeviceId,
    getPilotByVehicleId,
    checkAchievement,
    updateAchievementProgress
};

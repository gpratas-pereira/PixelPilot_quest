-- Migration to add pilot_display_name to pit_lane_registrations table

-- Add the new column if it doesn't exist
ALTER TABLE pit_lane_registrations ADD COLUMN pilot_display_name TEXT;

-- Update existing records to set pilot_display_name to the same as pilot_name
UPDATE pit_lane_registrations SET pilot_display_name = pilot_name WHERE pilot_display_name IS NULL;

-- Add the column to the devices table for current_assignment if it doesn't exist
-- Note: SQLite doesn't support direct ALTER TABLE for JSON columns, so we handle this in the application code

-- Update the devices table to include pilot_display_name in current_assignment
-- This will be handled in the application code by updating the current_assignment JSON

PRAGMA user_version = 2; -- Increment the schema version

-- ============================================================================
-- RBAC USER GROUPS MIGRATION
-- Creates a simple mapping table between Supabase users and RBAC groups.
-- Run this in the Supabase SQL editor or through your migration pipeline.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE user_groups
    ADD CONSTRAINT user_groups_group_name_not_empty
        CHECK (char_length(trim(group_name)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS user_groups_user_group_unique
    ON user_groups (user_id, lower(group_name));

ALTER TABLE user_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own groups"
    ON user_groups FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access"
    ON user_groups FOR ALL
    USING (auth.role() = 'service_role');

COMMENT ON TABLE user_groups IS 'Maps Supabase users to backend RBAC groups such as rewards_admin or payments_admin.';
COMMENT ON COLUMN user_groups.group_name IS 'Lowercase group identifier used by the Express server for RBAC checks.';


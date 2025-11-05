-- Migration: Add photo_url columns for photo upload functionality
-- Execute these statements in your Supabase SQL editor

-- Add photo_url column to marketplace_items table (if it exists)
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE marketplace_items ADD COLUMN photo_url TEXT;
        RAISE NOTICE 'Added photo_url column to marketplace_items';
    EXCEPTION
        WHEN duplicate_column THEN 
            RAISE NOTICE 'Column photo_url already exists in marketplace_items';
        WHEN undefined_table THEN
            RAISE NOTICE 'Table marketplace_items does not exist yet';
    END;
END $$;

-- Add photo_url column to vehicles table (if it exists)
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE vehicles ADD COLUMN photo_url TEXT;
        RAISE NOTICE 'Added photo_url column to vehicles';
    EXCEPTION
        WHEN duplicate_column THEN 
            RAISE NOTICE 'Column photo_url already exists in vehicles';
        WHEN undefined_table THEN
            RAISE NOTICE 'Table vehicles does not exist yet';
    END;
END $$;

-- Create storage buckets for photo uploads
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('pilot-photos', 'pilot-photos', true),
    ('marketplace-photos', 'marketplace-photos', true), 
    ('vehicle-photos', 'vehicle-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for pilot photos
CREATE POLICY "Pilots can upload their own photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'pilot-photos' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Pilots can update their own photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'pilot-photos' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Pilots can delete their own photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'pilot-photos' AND 
        auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Anyone can view pilot photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'pilot-photos');

-- Create storage policies for marketplace photos (admin only)
CREATE POLICY "Admins can upload marketplace photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'marketplace-photos' AND 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email = ANY(string_to_array(current_setting('app.admin_emails', true), ','))
        )
    );

CREATE POLICY "Admins can update marketplace photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'marketplace-photos' AND 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email = ANY(string_to_array(current_setting('app.admin_emails', true), ','))
        )
    );

CREATE POLICY "Admins can delete marketplace photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'marketplace-photos' AND 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email = ANY(string_to_array(current_setting('app.admin_emails', true), ','))
        )
    );

CREATE POLICY "Anyone can view marketplace photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'marketplace-photos');

-- Create storage policies for vehicle photos (admin only)
CREATE POLICY "Admins can upload vehicle photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'vehicle-photos' AND 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email = ANY(string_to_array(current_setting('app.admin_emails', true), ','))
        )
    );

CREATE POLICY "Admins can update vehicle photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'vehicle-photos' AND 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email = ANY(string_to_array(current_setting('app.admin_emails', true), ','))
        )
    );

CREATE POLICY "Admins can delete vehicle photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'vehicle-photos' AND 
        EXISTS (
            SELECT 1 FROM auth.users 
            WHERE auth.users.id = auth.uid() 
            AND auth.users.email = ANY(string_to_array(current_setting('app.admin_emails', true), ','))
        )
    );

CREATE POLICY "Anyone can view vehicle photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'vehicle-photos');
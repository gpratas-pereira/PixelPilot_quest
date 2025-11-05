-- Simple fix for storage upload issues
-- Execute this in your Supabase SQL Editor if you're still having problems

-- Create storage buckets with simple settings
INSERT INTO storage.buckets (id, name, public)
VALUES 
    ('pilot-photos', 'pilot-photos', true),
    ('marketplace-photos', 'marketplace-photos', true), 
    ('vehicle-photos', 'vehicle-photos', true)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public;

-- Drop all existing storage policies to start fresh
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT schemaname, policyname, tablename FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage')
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON storage.objects';
    END LOOP;
END $$;

-- Create very permissive policies for testing (you can restrict these later)
CREATE POLICY "Allow authenticated users full access to pilot photos" 
ON storage.objects FOR ALL 
USING (bucket_id = 'pilot-photos' AND auth.role() = 'authenticated')
WITH CHECK (bucket_id = 'pilot-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users full access to marketplace photos" 
ON storage.objects FOR ALL 
USING (bucket_id = 'marketplace-photos' AND auth.role() = 'authenticated')
WITH CHECK (bucket_id = 'marketplace-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users full access to vehicle photos" 
ON storage.objects FOR ALL 
USING (bucket_id = 'vehicle-photos' AND auth.role() = 'authenticated')
WITH CHECK (bucket_id = 'vehicle-photos' AND auth.role() = 'authenticated');

-- Allow public read access to all buckets
CREATE POLICY "Public read access to pilot photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'pilot-photos');

CREATE POLICY "Public read access to marketplace photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'marketplace-photos');

CREATE POLICY "Public read access to vehicle photos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'vehicle-photos');
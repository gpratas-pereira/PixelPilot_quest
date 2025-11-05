-- Create storage buckets for photo uploads
-- Execute this in your Supabase SQL Editor

-- Create the storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('pilot-photos', 'pilot-photos', true, 5242880, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
    ('marketplace-photos', 'marketplace-photos', true, 10485760, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']), 
    ('vehicle-photos', 'vehicle-photos', true, 8388608, ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Enable RLS on storage.objects (should already be enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Pilots can upload their own photos" ON storage.objects;
DROP POLICY IF EXISTS "Pilots can update their own photos" ON storage.objects;
DROP POLICY IF EXISTS "Pilots can delete their own photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view pilot photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload marketplace photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update marketplace photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete marketplace photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view marketplace photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view vehicle photos" ON storage.objects;

-- Create storage policies for pilot photos
CREATE POLICY "Pilots can upload their own photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'pilot-photos' AND 
        auth.uid() IS NOT NULL AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Pilots can update their own photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'pilot-photos' AND 
        auth.uid() IS NOT NULL AND
        (storage.foldername(name))[1] = auth.uid()::text
    ) WITH CHECK (
        bucket_id = 'pilot-photos' AND 
        auth.uid() IS NOT NULL AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Pilots can delete their own photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'pilot-photos' AND 
        auth.uid() IS NOT NULL AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Anyone can view pilot photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'pilot-photos');

-- Create storage policies for marketplace photos (allow authenticated users for now)
CREATE POLICY "Authenticated users can upload marketplace photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'marketplace-photos' AND 
        auth.uid() IS NOT NULL
    );

CREATE POLICY "Authenticated users can update marketplace photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'marketplace-photos' AND 
        auth.uid() IS NOT NULL
    ) WITH CHECK (
        bucket_id = 'marketplace-photos' AND 
        auth.uid() IS NOT NULL
    );

CREATE POLICY "Authenticated users can delete marketplace photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'marketplace-photos' AND 
        auth.uid() IS NOT NULL
    );

CREATE POLICY "Anyone can view marketplace photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'marketplace-photos');

-- Create storage policies for vehicle photos (allow authenticated users for now)
CREATE POLICY "Authenticated users can upload vehicle photos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'vehicle-photos' AND 
        auth.uid() IS NOT NULL
    );

CREATE POLICY "Authenticated users can update vehicle photos" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'vehicle-photos' AND 
        auth.uid() IS NOT NULL
    ) WITH CHECK (
        bucket_id = 'vehicle-photos' AND 
        auth.uid() IS NOT NULL
    );

CREATE POLICY "Authenticated users can delete vehicle photos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'vehicle-photos' AND 
        auth.uid() IS NOT NULL
    );

CREATE POLICY "Anyone can view vehicle photos" ON storage.objects
    FOR SELECT USING (bucket_id = 'vehicle-photos');
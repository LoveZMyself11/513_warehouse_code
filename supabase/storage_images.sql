-- Run after schema_v2.sql and auth_and_rls.sql.
-- Public reads are intentional because inventory image URLs are rendered directly
-- by the browser. Uploads and cleanup remain restricted by Storage RLS.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inventory-images',
  'inventory-images',
  TRUE,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Active users upload inventory images" ON storage.objects;
CREATE POLICY "Active users upload inventory images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'inventory-images'
  AND (SELECT private.current_app_user_id()) IS NOT NULL
  AND (storage.foldername(name))[1] = 'inventory'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
);

DROP POLICY IF EXISTS "Owners delete inventory image uploads" ON storage.objects;
CREATE POLICY "Owners delete inventory image uploads"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'inventory-images'
  AND (SELECT private.current_app_user_id()) IS NOT NULL
  AND owner_id = (SELECT auth.uid())::TEXT
  AND (storage.foldername(name))[1] = 'inventory'
  AND (storage.foldername(name))[2] = (SELECT auth.uid())::TEXT
);

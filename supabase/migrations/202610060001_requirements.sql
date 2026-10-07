-- Requirements completion: announcements, shelf QR payloads, and optional return photos.
-- Run after the inventory/auth/borrow migrations.

BEGIN;

ALTER TABLE public.inventory_locations
  ADD COLUMN IF NOT EXISTS qr_payload TEXT;

UPDATE public.inventory_locations
SET qr_payload = '513-warehouse:' || code
WHERE qr_payload IS NULL;

ALTER TABLE public.inventory_locations
  ALTER COLUMN qr_payload SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_qr_payload_unique
  ON public.inventory_locations(qr_payload);

CREATE TABLE IF NOT EXISTS public.system_announcements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL CHECK (btrim(title) <> ''),
  content TEXT NOT NULL CHECK (btrim(content) <> ''),
  target_role TEXT CHECK (target_role IS NULL OR target_role IN ('super_admin', 'admin', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS system_announcements_active_idx
  ON public.system_announcements(is_active, starts_at DESC, ends_at);

ALTER TABLE public.system_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.system_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.system_announcements TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.system_announcements TO authenticated;
GRANT USAGE ON SEQUENCE public.system_announcements_id_seq TO authenticated;

DROP POLICY IF EXISTS "Active users view announcements" ON public.system_announcements;
CREATE POLICY "Active users view announcements" ON public.system_announcements
FOR SELECT TO authenticated
USING (
  (SELECT private.current_app_user_id()) IS NOT NULL
  AND is_active
  AND starts_at <= NOW()
  AND (ends_at IS NULL OR ends_at >= NOW())
  AND (target_role IS NULL OR target_role = (SELECT private.current_app_role()))
);

DROP POLICY IF EXISTS "Super admins manage announcements" ON public.system_announcements;
CREATE POLICY "Super admins manage announcements" ON public.system_announcements
FOR ALL TO authenticated
USING ((SELECT private.current_app_role()) = 'super_admin')
WITH CHECK ((SELECT private.current_app_role()) = 'super_admin');

ALTER TABLE public.borrow_return_items
  ALTER COLUMN photo_path DROP NOT NULL;

COMMIT;

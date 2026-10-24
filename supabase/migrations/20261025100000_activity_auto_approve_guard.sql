BEGIN;

-- Only a valid (active, past the password gate) super administrator may enable or
-- change activities.auto_approve_borrows. Department admins keep maintaining every
-- other activity field via the existing RLS policies; the flag itself is guarded at
-- the table level so direct Supabase API writes cannot bypass the restriction.
-- Service contexts (edge functions, migrations) keep their existing exemption,
-- matching the users_protect_password_change_flag convention.
CREATE OR REPLACE FUNCTION private.guard_activity_auto_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only a VALUE CHANGE needs protection: inserting with the default false, or an
  -- UPDATE that keeps the current flag while editing other fields, passes for
  -- everyone who already passes RLS.
  IF TG_OP = 'INSERT' THEN
    IF NEW.auto_approve_borrows IS NOT TRUE THEN RETURN NEW; END IF;
  ELSE
    IF NEW.auto_approve_borrows IS NOT DISTINCT FROM OLD.auto_approve_borrows THEN RETURN NEW; END IF;
  END IF;
  -- Service/definer contexts (no request identity) and service_role stay exempt.
  IF (SELECT auth.uid()) IS NULL
    OR COALESCE((SELECT auth.jwt()) ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF (SELECT private.current_app_role()) = 'super_admin' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only active super administrators can change activity auto approval';
END;
$$;
REVOKE ALL ON FUNCTION private.guard_activity_auto_approve() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS activities_guard_auto_approve ON public.activities;
CREATE TRIGGER activities_guard_auto_approve
BEFORE INSERT OR UPDATE OF auto_approve_borrows ON public.activities
FOR EACH ROW EXECUTE FUNCTION private.guard_activity_auto_approve();

COMMIT;

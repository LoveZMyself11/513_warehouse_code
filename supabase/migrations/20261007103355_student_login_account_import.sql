BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Existing logins keep their Auth email; student IDs are a unique lookup key.
CREATE UNIQUE INDEX IF NOT EXISTS users_student_id_normalized_unique
  ON public.users (lower(btrim(student_id)))
  WHERE student_id IS NOT NULL AND btrim(student_id) <> '';

UPDATE public.users
SET student_id = NULLIF(lower(btrim(student_id)), '')
WHERE student_id IS DISTINCT FROM NULLIF(lower(btrim(student_id)), '');

CREATE OR REPLACE FUNCTION private.normalize_student_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.student_id := NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.student_id)), '');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.normalize_student_id() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_normalize_student_id ON public.users;
CREATE TRIGGER users_normalize_student_id
BEFORE INSERT OR UPDATE OF student_id ON public.users
FOR EACH ROW EXECUTE FUNCTION private.normalize_student_id();

CREATE OR REPLACE FUNCTION private.protect_password_change_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND COALESCE((SELECT auth.jwt()) ->> 'role', '') <> 'service_role'
     AND (NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
          OR NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at) THEN
    RAISE EXCEPTION 'Password change state can only be updated by the account service';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_password_change_flag() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_protect_password_change_flag ON public.users;
CREATE TRIGGER users_protect_password_change_flag
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION private.protect_password_change_flag();

CREATE OR REPLACE FUNCTION private.current_app_user_id()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.id FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid()) AND u.is_active AND NOT u.must_change_password
  LIMIT 1
$$;
CREATE OR REPLACE FUNCTION private.current_app_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.role FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid()) AND u.is_active AND NOT u.must_change_password
  LIMIT 1
$$;
CREATE OR REPLACE FUNCTION private.current_app_department_id()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT u.department_id FROM public.users u
  WHERE u.auth_user_id = (SELECT auth.uid()) AND u.is_active AND NOT u.must_change_password
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.current_app_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_app_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_app_department_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_app_department_id() TO authenticated;

CREATE TABLE IF NOT EXISTS private.account_login_attempts (
  key_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL
);
ALTER TABLE private.account_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.account_login_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_account_login_attempt(p_source_hash TEXT, p_identifier_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  source_count INTEGER;
  identifier_count INTEGER;
BEGIN
  IF length(p_source_hash) <> 64 OR length(p_identifier_hash) <> 64 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO private.account_login_attempts AS attempts (key_hash, window_started_at, attempts)
  VALUES ('source:' || p_source_hash, NOW(), 1)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE WHEN attempts.window_started_at < NOW() - INTERVAL '5 minutes' THEN NOW() ELSE attempts.window_started_at END,
    attempts = CASE WHEN attempts.window_started_at < NOW() - INTERVAL '5 minutes' THEN 1 ELSE attempts.attempts + 1 END
  RETURNING attempts.attempts INTO source_count;

  INSERT INTO private.account_login_attempts AS attempts (key_hash, window_started_at, attempts)
  VALUES ('identifier:' || p_identifier_hash, NOW(), 1)
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE WHEN attempts.window_started_at < NOW() - INTERVAL '5 minutes' THEN NOW() ELSE attempts.window_started_at END,
    attempts = CASE WHEN attempts.window_started_at < NOW() - INTERVAL '5 minutes' THEN 1 ELSE attempts.attempts + 1 END
  RETURNING attempts.attempts INTO identifier_count;

  DELETE FROM private.account_login_attempts WHERE window_started_at < NOW() - INTERVAL '1 day';
  RETURN source_count <= 60 AND identifier_count <= 15;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_account_login_attempt(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_account_login_attempt(TEXT, TEXT) TO service_role;

COMMIT;

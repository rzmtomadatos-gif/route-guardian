
-- Server-side allowlist enforcement via BEFORE INSERT trigger on auth.users.
-- This is the PRIMARY barrier (Lovable Cloud does not expose Supabase
-- Auth Hooks UI, so validate-signup-allowlist edge function cannot be
-- registered as Before User Created Hook). The edge function remains
-- deployed as defense-in-depth only.

CREATE OR REPLACE FUNCTION public.enforce_signup_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_allowed boolean;
BEGIN
  v_email := lower(trim(NEW.email));

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Registro no permitido'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails WHERE email = v_email
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    -- Generic error: do not reveal whether email exists in allowlist.
    RAISE EXCEPTION 'Registro no permitido. Solicita acceso a un administrador.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_signup_allowlist_trigger ON auth.users;

CREATE TRIGGER enforce_signup_allowlist_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_signup_allowlist();

COMMENT ON FUNCTION public.enforce_signup_allowlist() IS
  'Primary allowlist enforcement for new signups in Lovable Cloud. The validate-signup-allowlist edge function exists only as defense-in-depth and is not invoked because Auth Hooks cannot be registered from the Lovable Cloud UI.';

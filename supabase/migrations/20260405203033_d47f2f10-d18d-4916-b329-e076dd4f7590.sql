
-- 1. Fix role escalation: replace permissive UPDATE policy with column-restricted function
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;

CREATE OR REPLACE FUNCTION public.update_own_profile(p_full_name text DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    full_name = COALESCE(p_full_name, full_name),
    email = COALESCE(p_email, email)
  WHERE id = auth.uid();
END;
$$;

-- Still allow users to read own profile
-- (SELECT policy already exists)

-- Add a restricted UPDATE policy that prevents role/org changes
CREATE POLICY "Users update own profile safe" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND organization_id IS NOT DISTINCT FROM (SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- 2. Remove public read access to copilot_sessions
-- All access goes through RPC functions (SECURITY DEFINER) with token validation
DROP POLICY IF EXISTS "Public read copilot sessions" ON public.copilot_sessions;

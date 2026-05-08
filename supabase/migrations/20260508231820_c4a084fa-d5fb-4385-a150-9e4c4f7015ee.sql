-- 1) Drop redundant role column on profiles (authoritative roles live in user_roles)
DROP POLICY IF EXISTS "Users update own profile safe" ON public.profiles;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

CREATE POLICY "Users update own profile safe"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND NOT (organization_id IS DISTINCT FROM (
    SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
  ))
);

-- 2) Prevent anonymous enumeration of the signup allowlist.
-- The authoritative enforcement is the validate-signup-allowlist auth hook.
REVOKE EXECUTE ON FUNCTION public.check_email_allowed(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.check_email_allowed(text) TO authenticated;
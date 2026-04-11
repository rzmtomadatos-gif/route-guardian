
-- Create RPC to check if an email is in the allowlist (public access, no auth needed)
CREATE OR REPLACE FUNCTION public.check_email_allowed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails
    WHERE email = lower(trim(p_email))
  )
$$;

-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public read allowed_emails" ON public.allowed_emails;

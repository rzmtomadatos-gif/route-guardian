
-- 1. Revoke column-level SELECT on token from anon and authenticated roles
-- This prevents anyone from reading the token column via REST API or realtime
REVOKE SELECT (token) ON public.copilot_sessions FROM anon;
REVOKE SELECT (token) ON public.copilot_sessions FROM authenticated;

-- 2. Create RPC for driver to look up session by token (returns session without exposing token to SELECT)
CREATE OR REPLACE FUNCTION public.read_copilot_session_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT to_jsonb(cs.*) INTO result
  FROM copilot_sessions cs
  WHERE cs.token = p_token;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

-- 3. Clean up ended sessions older than 7 days to reduce exposure surface
DELETE FROM public.copilot_sessions
WHERE status = 'ended' AND updated_at < now() - interval '7 days';

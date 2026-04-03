
-- 1. Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Public insert copilot sessions" ON public.copilot_sessions;

-- 2. Add CHECK constraint on status
ALTER TABLE public.copilot_sessions
ADD CONSTRAINT copilot_sessions_status_check
CHECK (status IN ('waiting', 'navigating', 'ended', 'blocked'));

-- 3. Add CHECK constraint on batch_url (must be Google Maps or null)
ALTER TABLE public.copilot_sessions
ADD CONSTRAINT copilot_sessions_batch_url_check
CHECK (batch_url IS NULL OR batch_url LIKE 'https://www.google.com/maps/%');

-- 4. Create secure RPC for session creation
CREATE OR REPLACE FUNCTION public.create_copilot_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  INSERT INTO copilot_sessions (status, queue, cursor_index)
  VALUES ('waiting', '[]'::jsonb, 0)
  RETURNING to_jsonb(copilot_sessions.*) INTO result;

  RETURN result;
END;
$$;

-- 1. Strip token column from SECURITY DEFINER RPC outputs
CREATE OR REPLACE FUNCTION public.read_copilot_session_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT to_jsonb(cs.*) - 'token' INTO result
  FROM copilot_sessions cs
  WHERE cs.token = p_token;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  -- Echo back the token the caller already knows so existing clients don't break,
  -- but never reveal a token they didn't already provide.
  RETURN result || jsonb_build_object('token', p_token);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_copilot_session(p_token text, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  UPDATE copilot_sessions
  SET
    segment_name    = COALESCE(p_updates->>'segment_name', segment_name),
    segment_id      = COALESCE(p_updates->>'segment_id', segment_id),
    destination_lat = COALESCE((p_updates->>'destination_lat')::double precision, destination_lat),
    destination_lng = COALESCE((p_updates->>'destination_lng')::double precision, destination_lng),
    status          = COALESCE(p_updates->>'status', status),
    track_number    = CASE WHEN p_updates ? 'track_number' THEN (p_updates->>'track_number')::integer ELSE track_number END,
    queue           = CASE WHEN p_updates ? 'queue' THEN (p_updates->'queue') ELSE queue END,
    cursor_index    = COALESCE((p_updates->>'cursor_index')::integer, cursor_index),
    batch_number    = COALESCE((p_updates->>'batch_number')::integer, batch_number),
    batch_url       = CASE WHEN p_updates ? 'batch_url' THEN p_updates->>'batch_url' ELSE batch_url END,
    updated_at      = now()
  WHERE token = p_token
  RETURNING (to_jsonb(copilot_sessions.*) - 'token') INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Invalid session token' USING ERRCODE = 'P0002';
  END IF;

  RETURN result || jsonb_build_object('token', p_token);
END;
$function$;

-- create_copilot_session keeps returning token (the caller is the operator who needs it)
-- but require authentication (already enforced inside the function); also tighten EXECUTE.
REVOKE EXECUTE ON FUNCTION public.create_copilot_session() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_own_profile(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_copilot_session(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;

-- 2. Lock down copilot_sessions: drop public SELECT, allow only authenticated operators.
-- Drivers no longer read the table directly; they call read_copilot_session_by_token RPC.
DROP POLICY IF EXISTS "Public read copilot sessions (token protected)" ON public.copilot_sessions;
DROP POLICY IF EXISTS "Public can read copilot sessions" ON public.copilot_sessions;
DROP POLICY IF EXISTS "Anyone can read copilot sessions" ON public.copilot_sessions;

CREATE POLICY "Authenticated users can read copilot sessions"
  ON public.copilot_sessions
  FOR SELECT
  TO authenticated
  USING (true);

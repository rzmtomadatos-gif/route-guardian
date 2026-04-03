
-- 1. Drop the permissive UPDATE and DELETE policies
DROP POLICY IF EXISTS "Public update copilot sessions" ON public.copilot_sessions;
DROP POLICY IF EXISTS "Public delete copilot sessions" ON public.copilot_sessions;

-- 2. Create token-gated UPDATE function
CREATE OR REPLACE FUNCTION public.update_copilot_session(
  p_token text,
  p_updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  RETURNING to_jsonb(copilot_sessions.*) INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Invalid session token' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

-- 3. Create token-gated DELETE function
CREATE OR REPLACE FUNCTION public.delete_copilot_session(
  p_token text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM copilot_sessions WHERE token = p_token;
END;
$$;

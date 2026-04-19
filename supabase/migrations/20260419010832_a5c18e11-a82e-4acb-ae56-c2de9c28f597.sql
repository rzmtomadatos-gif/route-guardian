CREATE OR REPLACE FUNCTION public.create_copilot_session()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  -- Only authenticated operators can create sessions.
  -- Driver-side reads/updates remain token-gated and do not require auth.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: authentication required to create copilot session'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO copilot_sessions (status, queue, cursor_index)
  VALUES ('waiting', '[]'::jsonb, 0)
  RETURNING to_jsonb(copilot_sessions.*) INTO result;

  RETURN result;
END;
$function$;
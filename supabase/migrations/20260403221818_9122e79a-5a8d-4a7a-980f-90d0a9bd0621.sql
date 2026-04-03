-- Revocar SELECT a nivel de tabla completa (esto anula cualquier grant previo)
REVOKE SELECT ON public.copilot_sessions FROM anon;
REVOKE SELECT ON public.copilot_sessions FROM authenticated;

-- Conceder SELECT solo en columnas NO sensibles (excluyendo token)
GRANT SELECT (
  id, segment_name, segment_id,
  destination_lat, destination_lng, status,
  track_number, created_at, updated_at,
  queue, cursor_index, batch_number, batch_url
) ON public.copilot_sessions TO anon;

GRANT SELECT (
  id, segment_name, segment_id,
  destination_lat, destination_lng, status,
  track_number, created_at, updated_at,
  queue, cursor_index, batch_number, batch_url
) ON public.copilot_sessions TO authenticated;
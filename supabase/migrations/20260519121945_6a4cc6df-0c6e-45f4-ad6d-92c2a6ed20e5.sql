CREATE OR REPLACE FUNCTION public.operator_update_session(p_session_id uuid, p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_session public.copilot_sessions;
  v_old_batch integer;
  v_new_batch integer;
  v_has_batch_url boolean;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;

  select * into v_session from public.copilot_sessions where id = p_session_id;
  if v_session.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if v_session.operator_user_id <> auth.uid() then
    raise exception 'Not session owner' using errcode = '42501';
  end if;
  if v_session.status = 'ended' then
    raise exception 'Session ended' using errcode = 'P0001';
  end if;

  v_old_batch := coalesce(v_session.batch_number, 0);
  v_has_batch_url := p_updates ? 'batch_url' and nullif(p_updates->>'batch_url', '') is not null;

  update public.copilot_sessions
  set
    segment_name    = coalesce(p_updates->>'segment_name', segment_name),
    segment_id      = coalesce(p_updates->>'segment_id', segment_id),
    destination_lat = coalesce((p_updates->>'destination_lat')::double precision, destination_lat),
    destination_lng = coalesce((p_updates->>'destination_lng')::double precision, destination_lng),
    status          = coalesce(p_updates->>'status', status),
    track_number    = case when p_updates ? 'track_number' then (p_updates->>'track_number')::integer else track_number end,
    queue           = case when p_updates ? 'queue' then (p_updates->'queue') else queue end,
    cursor_index    = coalesce((p_updates->>'cursor_index')::integer, cursor_index),
    batch_url       = case when p_updates ? 'batch_url' then p_updates->>'batch_url' else batch_url end,
    batch_number    = case
                        when v_has_batch_url then coalesce(batch_number, 0) + 1
                        when p_updates ? 'batch_number' then greatest((p_updates->>'batch_number')::integer, coalesce(batch_number, 0))
                        else batch_number
                      end,
    updated_at      = now()
  where id = p_session_id
  returning * into v_session;

  v_new_batch := coalesce(v_session.batch_number, 0);

  if p_updates ? 'queue' then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (p_session_id, 'operator', auth.uid(), 'OPERATOR_QUEUE_PUSHED',
            jsonb_build_object('cursor_index', v_session.cursor_index, 'queue_length', jsonb_array_length(v_session.queue)));
  end if;

  if v_new_batch > v_old_batch then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (p_session_id, 'operator', auth.uid(), 'OPERATOR_BATCH_SENT',
            jsonb_build_object('batch_number', v_new_batch, 'queue_length', jsonb_array_length(v_session.queue), 'has_batch_url', v_session.batch_url is not null));
  end if;

  return to_jsonb(v_session) - 'token' - 'driver_token_hash';
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_send_batch(
  p_session_id uuid,
  p_queue jsonb,
  p_cursor_index integer,
  p_batch_url text,
  p_segment_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_session public.copilot_sessions;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;

  select * into v_session from public.copilot_sessions where id = p_session_id;
  if v_session.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if v_session.operator_user_id <> auth.uid() then
    raise exception 'Not session owner' using errcode = '42501';
  end if;
  if v_session.status = 'ended' then
    raise exception 'Session ended' using errcode = 'P0001';
  end if;
  if p_batch_url is null or length(trim(p_batch_url)) = 0 then
    raise exception 'Missing batch url' using errcode = '22023';
  end if;
  if p_queue is null or jsonb_typeof(p_queue) <> 'array' or jsonb_array_length(p_queue) = 0 then
    raise exception 'Missing queue' using errcode = '22023';
  end if;

  update public.copilot_sessions
     set queue = p_queue,
         cursor_index = coalesce(p_cursor_index, 0),
         status = 'navigating',
         segment_name = coalesce(p_segment_meta->>'segment_name', p_queue->0->>'name', segment_name),
         segment_id = coalesce(p_segment_meta->>'segment_id', p_queue->0->>'segmentId', segment_id),
         destination_lat = coalesce((p_segment_meta->>'destination_lat')::double precision, (p_queue->0->>'lat')::double precision, destination_lat),
         destination_lng = coalesce((p_segment_meta->>'destination_lng')::double precision, (p_queue->0->>'lng')::double precision, destination_lng),
         track_number = case when p_segment_meta ? 'track_number' then (p_segment_meta->>'track_number')::integer else track_number end,
         batch_url = p_batch_url,
         batch_number = coalesce(batch_number, 0) + 1,
         updated_at = now()
   where id = p_session_id
   returning * into v_session;

  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  values (p_session_id, 'operator', auth.uid(), 'OPERATOR_BATCH_SENT',
          jsonb_build_object(
            'batch_number', v_session.batch_number,
            'queue_length', jsonb_array_length(v_session.queue),
            'cursor_index', v_session.cursor_index,
            'meta', coalesce(p_segment_meta, '{}'::jsonb)
          ));

  return to_jsonb(v_session) - 'token' - 'driver_token_hash';
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_driver_pairing(p_nonce text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_pairing public.copilot_pairings;
  v_session public.copilot_sessions;
  v_token text;
  v_token_hash text;
  v_recent_attempts int;
begin
  if auth.uid() is null then
    return jsonb_build_object('status', 'error', 'reason', 'unauthorized');
  end if;

  if not (public.has_role(auth.uid(), 'driver')
       or public.has_role(auth.uid(), 'operator')
       or public.has_role(auth.uid(), 'admin')) then
    return jsonb_build_object('status', 'error', 'reason', 'role_not_allowed');
  end if;

  if p_nonce is null or length(p_nonce) < 16 then
    return jsonb_build_object('status', 'error', 'reason', 'unknown');
  end if;

  select count(*) into v_recent_attempts
    from public.copilot_session_events e
   where e.actor_user_id = auth.uid()
     and e.event_type = 'PAIRING_CLAIM_FAILED'
     and e.created_at > now() - interval '60 seconds';
  if v_recent_attempts >= 5 then
    return jsonb_build_object('status', 'error', 'reason', 'rate_limited');
  end if;

  select * into v_pairing
    from public.copilot_pairings
   where nonce_hash = public.hash_token(p_nonce);

  if v_pairing.id is null then
    return jsonb_build_object('status', 'error', 'reason', 'unknown');
  end if;

  update public.copilot_pairings
     set consume_attempts = consume_attempts + 1,
         last_attempt_at = now()
   where id = v_pairing.id;

  if v_pairing.revoked_at is not null then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED', jsonb_build_object('reason', 'revoked'));
    return jsonb_build_object('status', 'error', 'reason', 'revoked');
  end if;

  if v_pairing.consumed_at is not null then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED', jsonb_build_object('reason', 'already_consumed'));
    return jsonb_build_object('status', 'error', 'reason', 'already_consumed');
  end if;

  if v_pairing.expires_at <= now() then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED', jsonb_build_object('reason', 'expired'));
    return jsonb_build_object('status', 'error', 'reason', 'expired');
  end if;

  select * into v_session from public.copilot_sessions where id = v_pairing.session_id;
  if v_session.id is null or v_session.status = 'ended' then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED', jsonb_build_object('reason', 'session_ended'));
    return jsonb_build_object('status', 'error', 'reason', 'session_ended');
  end if;

  v_token := public._gen_url_token(32);
  v_token_hash := public.hash_token(v_token);

  update public.copilot_sessions
     set driver_user_id = auth.uid(),
         driver_token_hash = v_token_hash,
         driver_token_issued_at = now(),
         driver_last_seen_at = now()
   where id = v_session.id;

  update public.copilot_pairings
     set consumed_at = now(),
         consumed_by_user_id = auth.uid()
   where id = v_pairing.id;

  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  values (v_session.id, 'driver', auth.uid(), 'DRIVER_PAIRED', '{}'::jsonb);

  return jsonb_build_object(
    'status', 'ok',
    'session_id', v_session.id,
    'driver_token', v_token,
    'expires_at', v_session.expires_at
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.operator_send_batch(uuid, jsonb, integer, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.operator_send_batch(uuid, jsonb, integer, text, jsonb) TO authenticated;
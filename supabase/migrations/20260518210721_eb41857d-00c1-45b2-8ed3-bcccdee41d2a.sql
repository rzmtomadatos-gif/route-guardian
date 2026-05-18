-- ============================================================
-- FASE A — Driver/Copiloto seguro
-- ============================================================

create extension if not exists pgcrypto;

-- ─── 0. Rol nuevo ────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'driver'
  ) then
    alter type public.app_role add value 'driver';
  end if;
end$$;

-- ─── 1. copilot_sessions: nuevas columnas ────────────────────
alter table public.copilot_sessions
  add column if not exists operator_user_id uuid references auth.users(id),
  add column if not exists driver_user_id uuid references auth.users(id),
  add column if not exists driver_token_hash text,
  add column if not exists driver_token_issued_at timestamptz,
  add column if not exists driver_last_seen_at timestamptz,
  add column if not exists last_route_received_batch integer,
  add column if not exists last_route_opened_batch integer,
  add column if not exists last_route_opened_at timestamptz,
  add column if not exists expires_at timestamptz;

-- token antiguo: quitar NOT NULL (la columna queda inerte)
alter table public.copilot_sessions alter column token drop not null;

-- Indices
create index if not exists copilot_sessions_operator_idx on public.copilot_sessions (operator_user_id);
create index if not exists copilot_sessions_driver_idx on public.copilot_sessions (driver_user_id);
create unique index if not exists copilot_sessions_driver_token_hash_uq
  on public.copilot_sessions (driver_token_hash) where driver_token_hash is not null;

-- ─── 2. Invalidar sesiones antiguas (P0 corte) ───────────────
update public.copilot_sessions
   set status = 'ended',
       token = null,
       queue = '[]'::jsonb,
       expires_at = now()
 where status <> 'ended';

-- ─── 3. copilot_pairings ─────────────────────────────────────
create table if not exists public.copilot_pairings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.copilot_sessions(id) on delete cascade,
  operator_user_id uuid not null references auth.users(id),
  nonce_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  consumed_by_user_id uuid references auth.users(id),
  consume_attempts integer not null default 0,
  last_attempt_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
);
create index if not exists copilot_pairings_session_idx on public.copilot_pairings (session_id);
create unique index if not exists copilot_pairings_nonce_hash_uq on public.copilot_pairings (nonce_hash);

alter table public.copilot_pairings enable row level security;
-- Sin policies: acceso 100% por RPC SECURITY DEFINER.
revoke all on public.copilot_pairings from anon, authenticated;

-- ─── 4. copilot_session_events ───────────────────────────────
create table if not exists public.copilot_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.copilot_sessions(id) on delete cascade,
  actor text not null check (actor in ('operator','driver','system')),
  actor_user_id uuid references auth.users(id),
  event_type text not null check (event_type in (
    'DRIVER_PAIRING_STARTED',
    'DRIVER_PAIRED',
    'DRIVER_ROUTE_RECEIVED',
    'DRIVER_ROUTE_OPENED',
    'DRIVER_SESSION_EXPIRED',
    'DRIVER_SESSION_ENDED',
    'DRIVER_ERROR_RECOVERED',
    'OPERATOR_QUEUE_PUSHED',
    'OPERATOR_BATCH_FORCED',
    'OPERATOR_SESSION_ENDED',
    'PAIRING_REVOKED',
    'PAIRING_CLAIM_FAILED'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists copilot_events_session_idx
  on public.copilot_session_events (session_id, created_at desc);

alter table public.copilot_session_events enable row level security;

create policy "events visible to operator/driver of session"
  on public.copilot_session_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.copilot_sessions cs
      where cs.id = session_id
        and (cs.operator_user_id = auth.uid() or cs.driver_user_id = auth.uid())
    )
  );

create policy "events visible to admins"
  on public.copilot_session_events
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Sin INSERT policy: solo vía RPC SECURITY DEFINER.

-- ─── 5. copilot_sessions: RLS reset ──────────────────────────
drop policy if exists "Authenticated users can read copilot sessions" on public.copilot_sessions;

create policy "sessions visible to owner operator or paired driver"
  on public.copilot_sessions
  for select
  to authenticated
  using (operator_user_id = auth.uid() or driver_user_id = auth.uid());

-- Sin INSERT/UPDATE/DELETE policies: solo vía RPC.
revoke select (token, driver_token_hash) on public.copilot_sessions from anon, authenticated;

-- ─── 6. Helpers ──────────────────────────────────────────────
create or replace function public.hash_token(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

create or replace function public._gen_url_token(p_bytes int default 32)
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(extensions.gen_random_bytes(p_bytes), 'hex')
$$;

-- ─── 7. RPCs antiguas: revocar ───────────────────────────────
revoke execute on function public.update_copilot_session(text, jsonb) from anon, authenticated;
revoke execute on function public.read_copilot_session_by_token(text) from anon, authenticated;
revoke execute on function public.delete_copilot_session(text) from anon, authenticated;

-- ─── 8. RPC: create_copilot_session (operador) ───────────────
-- Reemplaza la firma anterior (sin argumentos) y devuelve solo IDs.
create or replace function public.create_copilot_session()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if not (public.has_role(auth.uid(), 'operator')
       or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Role not allowed' using errcode = '42501';
  end if;

  insert into public.copilot_sessions (
    operator_user_id, status, queue, cursor_index, expires_at
  )
  values (
    auth.uid(), 'waiting', '[]'::jsonb, 0, now() + interval '12 hours'
  )
  returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'expires_at', v_session.expires_at,
    'status', v_session.status
  );
end;
$$;

-- ─── 9. RPC: operator_generate_pairing ───────────────────────
create or replace function public.operator_generate_pairing(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
  v_nonce text;
  v_hash text;
  v_expires timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select * into v_session from public.copilot_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  if v_session.operator_user_id <> auth.uid() then
    raise exception 'Not session owner' using errcode = '42501';
  end if;
  if v_session.status = 'ended' then
    raise exception 'Session ended' using errcode = 'P0001';
  end if;

  -- Revocar pairings activos previos
  update public.copilot_pairings
     set revoked_at = now(),
         revoked_reason = 'superseded_by_new_pairing'
   where session_id = p_session_id
     and consumed_at is null
     and revoked_at is null
     and expires_at > now();

  -- Log revocaciones (una entrada por pairing revocado en este turno)
  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  select p.session_id, 'operator', auth.uid(), 'PAIRING_REVOKED',
         jsonb_build_object('pairing_id', p.id, 'reason', 'superseded_by_new_pairing')
    from public.copilot_pairings p
   where p.session_id = p_session_id
     and p.revoked_at = (select max(revoked_at) from public.copilot_pairings where session_id = p_session_id)
     and p.revoked_reason = 'superseded_by_new_pairing'
     and p.consumed_at is null;

  v_nonce := public._gen_url_token(32);
  v_hash := public.hash_token(v_nonce);
  v_expires := now() + interval '5 minutes';

  insert into public.copilot_pairings (
    session_id, operator_user_id, nonce_hash, expires_at
  ) values (
    p_session_id, auth.uid(), v_hash, v_expires
  );

  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  values (p_session_id, 'operator', auth.uid(), 'DRIVER_PAIRING_STARTED',
          jsonb_build_object('expires_at', v_expires));

  return jsonb_build_object(
    'nonce', v_nonce,
    'expires_at', v_expires
  );
end;
$$;

-- ─── 10. RPC: claim_driver_pairing (conductor autenticado) ───
create or replace function public.claim_driver_pairing(p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.copilot_pairings;
  v_session public.copilot_sessions;
  v_token text;
  v_token_hash text;
  v_recent_attempts int;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if not (public.has_role(auth.uid(), 'driver')
       or public.has_role(auth.uid(), 'operator')
       or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Role not allowed' using errcode = '42501';
  end if;

  if p_nonce is null or length(p_nonce) < 16 then
    raise exception 'Invalid nonce' using errcode = '22023';
  end if;

  -- Rate limit por usuario: máx 5 intentos en 60s
  select count(*) into v_recent_attempts
    from public.copilot_pairings p
   where p.last_attempt_at > now() - interval '60 seconds'
     and exists (
       select 1 from public.copilot_session_events e
        where e.session_id = p.session_id
          and e.actor_user_id = auth.uid()
          and e.event_type = 'PAIRING_CLAIM_FAILED'
          and e.created_at > now() - interval '60 seconds'
     );
  if v_recent_attempts >= 5 then
    raise exception 'Rate limited' using errcode = 'P0001';
  end if;

  select * into v_pairing
    from public.copilot_pairings
   where nonce_hash = public.hash_token(p_nonce);

  if v_pairing.id is null then
    -- No filtramos por sesión porque no hay match
    raise exception 'Pairing not found' using errcode = 'P0002';
  end if;

  update public.copilot_pairings
     set consume_attempts = consume_attempts + 1,
         last_attempt_at = now()
   where id = v_pairing.id;

  if v_pairing.revoked_at is not null then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED',
            jsonb_build_object('reason', 'revoked'));
    raise exception 'Pairing revoked' using errcode = 'P0001';
  end if;
  if v_pairing.consumed_at is not null then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED',
            jsonb_build_object('reason', 'already_consumed'));
    raise exception 'Pairing already consumed' using errcode = 'P0001';
  end if;
  if v_pairing.expires_at <= now() then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_pairing.session_id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED',
            jsonb_build_object('reason', 'expired'));
    raise exception 'Pairing expired' using errcode = 'P0001';
  end if;

  select * into v_session from public.copilot_sessions where id = v_pairing.session_id;
  if v_session.status = 'ended' then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_session.id, 'driver', auth.uid(), 'PAIRING_CLAIM_FAILED',
            jsonb_build_object('reason', 'session_ended'));
    raise exception 'Session ended' using errcode = 'P0001';
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
    'session_id', v_session.id,
    'driver_token', v_token,
    'expires_at', v_session.expires_at
  );
end;
$$;

-- ─── 11. RPC: driver_read_session ────────────────────────────
-- Devuelve siempre un JSON con `status` para que el cliente pueda
-- distinguir: ok / ended / expired / invalid_token.
create or replace function public.driver_read_session(p_driver_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_driver_token is null or length(p_driver_token) < 16 then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  v_hash := public.hash_token(p_driver_token);

  select * into v_session
    from public.copilot_sessions
   where driver_token_hash = v_hash
     and driver_user_id = auth.uid();

  if v_session.id is null then
    return jsonb_build_object('status', 'invalid_token');
  end if;

  if v_session.status = 'ended' then
    return jsonb_build_object('status', 'ended', 'session_id', v_session.id);
  end if;

  if v_session.expires_at is not null and v_session.expires_at <= now() then
    update public.copilot_sessions set status = 'ended' where id = v_session.id;
    insert into public.copilot_session_events (session_id, actor, event_type, payload)
    values (v_session.id, 'system', 'DRIVER_SESSION_EXPIRED', '{}'::jsonb);
    return jsonb_build_object('status', 'expired', 'session_id', v_session.id);
  end if;

  update public.copilot_sessions set driver_last_seen_at = now() where id = v_session.id;

  -- DRIVER_ROUTE_RECEIVED idempotente por batch_number
  if v_session.batch_number is not null
     and v_session.batch_number > 0
     and (v_session.last_route_received_batch is null
          or v_session.batch_number > v_session.last_route_received_batch)
  then
    update public.copilot_sessions
       set last_route_received_batch = v_session.batch_number
     where id = v_session.id;
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (v_session.id, 'driver', auth.uid(), 'DRIVER_ROUTE_RECEIVED',
            jsonb_build_object('batch_number', v_session.batch_number));
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'session_id', v_session.id,
    'session', jsonb_build_object(
      'id', v_session.id,
      'status', v_session.status,
      'segment_name', v_session.segment_name,
      'segment_id', v_session.segment_id,
      'destination_lat', v_session.destination_lat,
      'destination_lng', v_session.destination_lng,
      'track_number', v_session.track_number,
      'queue', v_session.queue,
      'cursor_index', v_session.cursor_index,
      'batch_number', v_session.batch_number,
      'batch_url', v_session.batch_url,
      'expires_at', v_session.expires_at,
      'last_route_opened_batch', v_session.last_route_opened_batch
    )
  );
end;
$$;

-- ─── 12. RPC: driver_mark_route_opened ───────────────────────
create or replace function public.driver_mark_route_opened(
  p_driver_token text,
  p_batch_number integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;

  select * into v_session
    from public.copilot_sessions
   where driver_token_hash = public.hash_token(p_driver_token)
     and driver_user_id = auth.uid();

  if v_session.id is null then
    raise exception 'Invalid token' using errcode = 'P0002';
  end if;
  if v_session.status = 'ended' then
    raise exception 'Session ended' using errcode = 'P0001';
  end if;

  update public.copilot_sessions
     set last_route_opened_batch = p_batch_number,
         last_route_opened_at = now()
   where id = v_session.id;

  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  values (v_session.id, 'driver', auth.uid(), 'DRIVER_ROUTE_OPENED',
          jsonb_build_object('batch_number', p_batch_number));

  return jsonb_build_object('ok', true);
end;
$$;

-- ─── 13. RPC: driver_report_recovered ────────────────────────
create or replace function public.driver_report_recovered(p_driver_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  select * into v_session
    from public.copilot_sessions
   where driver_token_hash = public.hash_token(p_driver_token)
     and driver_user_id = auth.uid();
  if v_session.id is null then return; end if;

  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  values (v_session.id, 'driver', auth.uid(), 'DRIVER_ERROR_RECOVERED', '{}'::jsonb);
end;
$$;

-- ─── 14. RPC: operator_update_session ────────────────────────
create or replace function public.operator_update_session(
  p_session_id uuid,
  p_updates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
  v_old_batch integer;
  v_new_batch integer;
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

  v_old_batch := v_session.batch_number;

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
    batch_number    = coalesce((p_updates->>'batch_number')::integer, batch_number),
    batch_url       = case when p_updates ? 'batch_url' then p_updates->>'batch_url' else batch_url end,
    updated_at      = now()
  where id = p_session_id
  returning * into v_session;

  v_new_batch := v_session.batch_number;

  if p_updates ? 'queue' then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (p_session_id, 'operator', auth.uid(), 'OPERATOR_QUEUE_PUSHED',
            jsonb_build_object('cursor_index', v_session.cursor_index));
  end if;

  if v_new_batch is not null and v_new_batch > coalesce(v_old_batch, 0) then
    insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
    values (p_session_id, 'operator', auth.uid(), 'OPERATOR_BATCH_FORCED',
            jsonb_build_object('batch_number', v_new_batch));
  end if;

  return to_jsonb(v_session) - 'token' - 'driver_token_hash';
end;
$$;

-- ─── 15. RPC: operator_end_session ───────────────────────────
create or replace function public.operator_end_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  select * into v_session from public.copilot_sessions where id = p_session_id;
  if v_session.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if v_session.operator_user_id <> auth.uid() then
    raise exception 'Not session owner' using errcode = '42501';
  end if;

  update public.copilot_sessions
     set status = 'ended',
         queue = '[]'::jsonb,
         expires_at = now(),
         driver_token_hash = null
   where id = p_session_id;

  update public.copilot_pairings
     set revoked_at = now(),
         revoked_reason = 'session_ended'
   where session_id = p_session_id
     and consumed_at is null
     and revoked_at is null;

  insert into public.copilot_session_events (session_id, actor, actor_user_id, event_type, payload)
  values
    (p_session_id, 'operator', auth.uid(), 'OPERATOR_SESSION_ENDED', '{}'::jsonb),
    (p_session_id, 'system', null, 'DRIVER_SESSION_ENDED', '{}'::jsonb);
end;
$$;

-- ─── 16. RPC: operator_get_session ───────────────────────────
create or replace function public.operator_get_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.copilot_sessions;
begin
  if auth.uid() is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  select * into v_session from public.copilot_sessions where id = p_session_id;
  if v_session.id is null or v_session.operator_user_id <> auth.uid() then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_session) - 'token' - 'driver_token_hash';
end;
$$;

-- ─── 17. Grants finales ──────────────────────────────────────
grant execute on function
  public.create_copilot_session(),
  public.operator_generate_pairing(uuid),
  public.operator_update_session(uuid, jsonb),
  public.operator_end_session(uuid),
  public.operator_get_session(uuid),
  public.claim_driver_pairing(text),
  public.driver_read_session(text),
  public.driver_mark_route_opened(text, integer),
  public.driver_report_recovered(text)
to authenticated;

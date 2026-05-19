import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const QUEUE_SIZE = 5;

/* ─── Types ─── */

export interface QueueItem {
  segmentId: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * Operator-facing session view. The legacy `token` field has been removed:
 * drivers now authenticate and hold a per-pairing `driver_token` outside this object.
 */
export interface CopilotSession {
  id: string;
  segment_name: string | null;
  segment_id: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  status: string;
  track_number: number | null;
  queue: QueueItem[];
  cursor_index: number;
  batch_number: number;
  batch_url: string | null;
  driver_user_id?: string | null;
  driver_last_seen_at?: string | null;
  expires_at?: string | null;
  last_route_opened_batch?: number | null;
}

export interface PairingInfo {
  nonce: string;
  expires_at: string;
}

export interface CopilotSendResult {
  ok: boolean;
  session: CopilotSession | null;
  error?: string;
}

export type DriverReadStatus = 'loading' | 'ok' | 'ended' | 'expired' | 'invalid_token' | 'error';
export type PairingClaimStatus = 'idle' | 'claiming' | 'ok' | 'error';
export type PairingClaimErrorReason =
  | 'expired'
  | 'revoked'
  | 'already_consumed'
  | 'role_not_allowed'
  | 'unauthorized'
  | 'session_ended'
  | 'rate_limited'
  | 'unknown';

export type PairingClaimResult =
  | { ok: true; driver_token: string; session_id: string }
  | { ok: false; reason: PairingClaimErrorReason };

/* ─── Internal helpers ─── */

const SESSION_ID_STORAGE_KEY = 'vialroute_copilot_session_id';
// supabase typed RPC list does not yet include the new functions; cast at call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);

function parseSessionRow(raw: unknown): CopilotSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.id || typeof r.id !== 'string') return null;
  const queueRaw = r.queue;
  let queue: QueueItem[] = [];
  if (Array.isArray(queueRaw)) queue = queueRaw as QueueItem[];
  else if (typeof queueRaw === 'string') {
    try { queue = JSON.parse(queueRaw) as QueueItem[]; } catch { queue = []; }
  }
  return {
    id: r.id as string,
    segment_name: (r.segment_name as string | null) ?? null,
    segment_id: (r.segment_id as string | null) ?? null,
    destination_lat: (r.destination_lat as number | null) ?? null,
    destination_lng: (r.destination_lng as number | null) ?? null,
    status: (r.status as string) ?? 'waiting',
    track_number: (r.track_number as number | null) ?? null,
    queue,
    cursor_index: (r.cursor_index as number) ?? 0,
    batch_number: (r.batch_number as number) ?? 0,
    batch_url: (r.batch_url as string | null) ?? null,
    driver_user_id: (r.driver_user_id as string | null) ?? null,
    driver_last_seen_at: (r.driver_last_seen_at as string | null) ?? null,
    expires_at: (r.expires_at as string | null) ?? null,
    last_route_opened_batch: (r.last_route_opened_batch as number | null) ?? null,
  };
}

function rpcErrorMessage(error: unknown, fallback: string) {
  const msg = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : String(error ?? '');
  return msg || fallback;
}

function classifyOperatorError(error: unknown, fallback = 'Error desconocido al iniciar Copiloto.') {
  const msg = rpcErrorMessage(error, fallback);
  if (/unauthorized|jwt|not authenticated|auth/i.test(msg)) return 'Usuario no autenticado. Inicia sesión antes de activar Copiloto.';
  if (/role not allowed|operator|admin|permission|42501/i.test(msg)) return 'Tu usuario no tiene rol operator/admin para activar Copiloto.';
  if (/network|fetch|supabase|database|server/i.test(msg)) return `Error de backend: ${msg}`;
  return msg || fallback;
}

function assertValidBatchResult(parsed: CopilotSession | null, previousBatch: number): CopilotSendResult {
  if (!parsed) return { ok: false, session: null, error: 'El backend no devolvió una sesión válida.' };
  if (!parsed.batch_url) return { ok: false, session: parsed, error: 'El backend no confirmó URL de lote.' };
  if ((parsed.queue?.length ?? 0) <= 0) return { ok: false, session: parsed, error: 'El backend no confirmó cola de tramos.' };
  if ((parsed.batch_number ?? 0) <= previousBatch) return { ok: false, session: parsed, error: 'El contador de lote no avanzó.' };
  return { ok: true, session: parsed };
}

/* ─── Operator side ─── */

export function useCopilotOperator() {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [active, setActive] = useState(false);
  const [lastRpcError, setLastRpcError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<CopilotSession | null>(null);

  useEffect(() => { sessionRef.current = session; }, [session]);

  // Recover session_id from sessionStorage on mount (survives page refresh).
  useEffect(() => {
    let cancelled = false;
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
    if (!stored) return;

    (async () => {
      const { data, error } = await rpc('operator_get_session', { p_session_id: stored });
      if (cancelled) return;
      if (error || !data) {
        setLastRpcError('Sesión existente no recuperable. Genera una sesión nueva de Copiloto.');
        try { sessionStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
        return;
      }
      const parsed = parseSessionRow(data);
      if (!parsed || parsed.status === 'ended') {
        setLastRpcError('Sesión existente no recuperable. Genera una sesión nueva de Copiloto.');
        try { sessionStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
        return;
      }
      sessionIdRef.current = parsed.id;
      setSession(parsed);
      setActive(true);
      setLastRpcError(null);
      setLastEvent('operator_get_session:recovered');
    })();

    return () => { cancelled = true; };
  }, []);

  // Realtime subscription — operator can SELECT own session row via RLS.
  useEffect(() => {
    if (!session || !active) return;
    const channel = supabase
      .channel(`copilot-op-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'copilot_sessions', filter: `id=eq.${session.id}` },
        (payload) => {
          const parsed = parseSessionRow(payload.new);
          if (!parsed) return;
          setSession(prev => prev ? { ...prev, ...parsed } : parsed);
          setLastEvent('realtime:session_update');
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id, active]);

  const createSession = useCallback(async (): Promise<CopilotSession | null> => {
    const { data, error } = await rpc('create_copilot_session');
    if (error || !data) {
      const message = classifyOperatorError(error, 'Error desconocido al iniciar Copiloto.');
      setLastRpcError(message);
      setLastEvent('create_copilot_session:failed');
      console.error('[copilot] create_copilot_session failed:', error);
      throw new Error(message);
    }
    const sessionId = (data as { session_id?: string }).session_id;
    if (!sessionId) {
      const message = 'El backend no devolvió session_id para Copiloto.';
      setLastRpcError(message);
      setLastEvent('create_copilot_session:invalid_response');
      throw new Error(message);
    }

    // Fetch full row to populate state (RPC returns only metadata).
    const { data: full, error: getErr } = await rpc('operator_get_session', { p_session_id: sessionId });
    if (getErr || !full) {
      const message = classifyOperatorError(getErr, 'Sesión creada, pero no se pudo recuperar su estado.');
      setLastRpcError(message);
      setLastEvent('operator_get_session:failed_after_create');
      throw new Error(message);
    }
    const parsed = parseSessionRow(full);
    if (!parsed) {
      const message = 'Sesión existente no recuperable. Genera una sesión nueva de Copiloto.';
      setLastRpcError(message);
      setLastEvent('operator_get_session:unrecoverable');
      throw new Error(message);
    }

    sessionIdRef.current = parsed.id;
    try { sessionStorage.setItem(SESSION_ID_STORAGE_KEY, parsed.id); } catch { /* ignore */ }
    setSession(parsed);
    setActive(true);
    setLastRpcError(null);
    setLastEvent('create_copilot_session:ok');
    return parsed;
  }, []);

  const applyUpdate = useCallback(async (updates: Record<string, unknown>): Promise<CopilotSession | null> => {
    const id = sessionIdRef.current;
    if (!id) throw new Error('Copiloto no tiene sesión activa.');
    const { data, error } = await rpc('operator_update_session', { p_session_id: id, p_updates: updates });
    if (error) {
      const message = rpcErrorMessage(error, 'Error actualizando Copiloto.');
      setLastRpcError(message);
      setLastEvent('operator_update_session:failed');
      console.error('[copilot] operator_update_session failed:', error);
      throw new Error(message);
    }
    const parsed = parseSessionRow(data);
    if (parsed) setSession(prev => prev ? { ...prev, ...parsed } : parsed);
    setLastRpcError(null);
    setLastEvent('operator_update_session:ok');
    return parsed;
  }, []);

  const pushQueue = useCallback(async (items: QueueItem[], cursorIndex: number, batchUrl?: string): Promise<CopilotSendResult> => {
    const id = sessionIdRef.current;
    if (!id) throw new Error('Copiloto no tiene sesión activa.');

    if (batchUrl && items.length > 0) {
      const previousBatch = sessionRef.current?.batch_number ?? 0;
      const first = items[0];
      const { data, error } = await rpc('operator_send_batch', {
        p_session_id: id,
        p_queue: items,
        p_cursor_index: cursorIndex,
        p_batch_url: batchUrl,
        p_segment_meta: {
          segment_name: first?.name ?? null,
          segment_id: first?.segmentId ?? null,
          destination_lat: first?.lat ?? null,
          destination_lng: first?.lng ?? null,
        },
      });
      if (error) {
        const message = rpcErrorMessage(error, 'Error enviando lote al conductor.');
        setLastRpcError(message);
        setLastEvent('operator_send_batch:failed');
        console.error('[copilot] operator_send_batch failed:', error);
        throw new Error(message);
      }
      const parsed = parseSessionRow(data);
      if (parsed) setSession(prev => prev ? { ...prev, ...parsed } : parsed);
      const result = assertValidBatchResult(parsed, previousBatch);
      if (!result.ok) {
        setLastRpcError(result.error ?? 'Envío no confirmado por backend.');
        setLastEvent('operator_send_batch:invalid_confirmation');
        throw new Error(result.error ?? 'Envío no confirmado por backend.');
      }
      setLastRpcError(null);
      setLastEvent(`operator_send_batch:ok#${parsed?.batch_number ?? '?'}`);
      return result;
    }

    const parsed = await applyUpdate({
      queue: items,
      cursor_index: cursorIndex,
      status: items.length > 0 ? 'navigating' : 'waiting',
      segment_name: items[0]?.name ?? null,
      segment_id: items[0]?.segmentId ?? null,
      destination_lat: items[0]?.lat ?? null,
      destination_lng: items[0]?.lng ?? null,
    });
    return { ok: true, session: parsed };
  }, [applyUpdate]);

  const forceSendBatch = useCallback(async (batchUrl: string): Promise<CopilotSendResult> => {
    const current = sessionRef.current;
    if (!current || !current.queue?.length) throw new Error('No hay cola de tramos para reenviar.');
    return pushQueue(current.queue, current.cursor_index, batchUrl);
  }, [pushQueue]);

  const setBlocked = useCallback(async () => { await applyUpdate({ status: 'blocked' }); }, [applyUpdate]);
  const setWaiting = useCallback(async () => { await applyUpdate({ status: 'waiting' }); }, [applyUpdate]);

  const endSession = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    const { error } = await rpc('operator_end_session', { p_session_id: id });
    if (error) {
      const message = rpcErrorMessage(error, 'Error finalizando Copiloto.');
      setLastRpcError(message);
      setLastEvent('operator_end_session:failed');
      console.error('[copilot] operator_end_session failed:', error);
    } else {
      setLastRpcError(null);
      setLastEvent('operator_end_session:ok');
    }
    try { sessionStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
    sessionIdRef.current = null;
    setSession(null);
    setActive(false);
  }, []);

  const generatePairing = useCallback(async (): Promise<PairingInfo | null> => {
    const id = sessionIdRef.current;
    if (!id) {
      setLastRpcError('Activa Copiloto antes de generar el QR.');
      return null;
    }
    const { data, error } = await rpc('operator_generate_pairing', { p_session_id: id });
    if (error || !data) {
      const message = rpcErrorMessage(error, 'No se pudo generar el QR de emparejamiento.');
      setLastRpcError(message);
      setLastEvent('operator_generate_pairing:failed');
      console.error('[copilot] operator_generate_pairing failed:', error);
      return null;
    }
    const d = data as { nonce?: string; expires_at?: string };
    if (!d.nonce || !d.expires_at || d.nonce === 'undefined') {
      setLastRpcError('El backend no devolvió un nonce válido para el QR.');
      setLastEvent('operator_generate_pairing:invalid_response');
      return null;
    }
    setLastRpcError(null);
    setLastEvent('operator_generate_pairing:ok');
    return { nonce: d.nonce, expires_at: d.expires_at };
  }, []);

  return {
    session,
    active,
    createSession,
    pushQueue,
    forceSendBatch,
    setBlocked,
    setWaiting,
    endSession,
    generatePairing,
    lastRpcError,
    lastEvent,
  };
}

/* ─── Driver side ─── */

export interface DriverState {
  status: DriverReadStatus;
  session: CopilotSession | null;
  sessionId: string | null;
  error?: string;
  lastPollAt?: string | null;
}

export function useCopilotDriver(driverToken: string | null) {
  const [state, setState] = useState<DriverState>({
    status: driverToken ? 'loading' : 'invalid_token',
    session: null,
    sessionId: null,
    lastPollAt: null,
  });
  const [manualRefresh, setManualRefresh] = useState(0);

  useEffect(() => {
    if (!driverToken) {
      setState({ status: 'invalid_token', session: null, sessionId: null, lastPollAt: null });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      const pollAt = new Date().toISOString();
      const { data, error } = await rpc('driver_read_session', { p_driver_token: driverToken });
      if (cancelled) return;
      if (error || !data) {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: rpcErrorMessage(error, 'network'),
          lastPollAt: pollAt,
        }));
        return;
      }
      const d = data as { status: DriverReadStatus; session_id?: string; session?: unknown };
      if (d.status === 'ok' && d.session) {
        const parsed = parseSessionRow(d.session);
        setState({ status: 'ok', session: parsed, sessionId: d.session_id ?? parsed?.id ?? null, error: undefined, lastPollAt: pollAt });
      } else {
        setState({ status: d.status, session: null, sessionId: d.session_id ?? null, error: undefined, lastPollAt: pollAt });
      }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, 3000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [driverToken, manualRefresh]);

  const refreshNow = useCallback(() => setManualRefresh((n) => n + 1), []);

  const markRouteOpened = useCallback(async (batchNumber: number) => {
    if (!driverToken) return;
    const { error } = await rpc('driver_mark_route_opened', {
      p_driver_token: driverToken,
      p_batch_number: batchNumber,
    });
    if (error) console.error('[copilot] driver_mark_route_opened failed:', error);
  }, [driverToken]);

  // Backwards-compatible aliases for existing consumers (loading/error fields).
  return {
    ...state,
    loading: state.status === 'loading',
    error: state.status === 'error' ? (state.error ?? 'error') : null,
    markRouteOpened,
    refreshNow,
  };
}

/**
 * Claim a pairing nonce and persist the resulting driver_token in localStorage,
 * keyed by session_id. Never returns or logs the token on failure.
 */
export async function claimDriverPairing(nonce: string): Promise<PairingClaimResult> {
  const { data, error } = await rpc('claim_driver_pairing', { p_nonce: nonce });
  if (error || !data) {
    console.error('[copilot] claim_driver_pairing failed:', error);
    return { ok: false, reason: 'unknown' };
  }
  const d = data as { status?: string; reason?: PairingClaimErrorReason; driver_token?: string; session_id?: string };
  if (d.status === 'error') return { ok: false, reason: d.reason ?? 'unknown' };
  if (!d.driver_token || !d.session_id) return { ok: false, reason: 'unknown' };
  try {
    localStorage.setItem(`vialroute_driver_token_${d.session_id}`, d.driver_token);
    localStorage.setItem('vialroute_active_driver_session_id', d.session_id);
  } catch { /* ignore */ }
  return { ok: true, driver_token: d.driver_token, session_id: d.session_id };
}

export function getStoredDriverToken(): { driver_token: string; session_id: string } | null {
  try {
    const sid = localStorage.getItem('vialroute_active_driver_session_id');
    if (!sid) return null;
    const tok = localStorage.getItem(`vialroute_driver_token_${sid}`);
    if (!tok) return null;
    return { driver_token: tok, session_id: sid };
  } catch { return null; }
}

export function clearStoredDriverToken() {
  try {
    const sid = localStorage.getItem('vialroute_active_driver_session_id');
    if (sid) localStorage.removeItem(`vialroute_driver_token_${sid}`);
    localStorage.removeItem('vialroute_active_driver_session_id');
  } catch { /* ignore */ }
}

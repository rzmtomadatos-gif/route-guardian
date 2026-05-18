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

export type DriverReadStatus = 'loading' | 'ok' | 'ended' | 'expired' | 'invalid_token' | 'error';

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

/* ─── Operator side ─── */

export function useCopilotOperator() {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [active, setActive] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

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
        try { sessionStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
        return;
      }
      const parsed = parseSessionRow(data);
      if (!parsed || parsed.status === 'ended') {
        try { sessionStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
        return;
      }
      sessionIdRef.current = parsed.id;
      setSession(parsed);
      setActive(true);
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
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id, active]);

  const createSession = useCallback(async (): Promise<CopilotSession | null> => {
    const { data, error } = await rpc('create_copilot_session');
    if (error || !data) {
      console.error('[copilot] create_copilot_session failed:', error);
      return null;
    }
    const sessionId = (data as { session_id?: string }).session_id;
    if (!sessionId) return null;

    // Fetch full row to populate state (RPC returns only metadata).
    const { data: full, error: getErr } = await rpc('operator_get_session', { p_session_id: sessionId });
    if (getErr || !full) return null;
    const parsed = parseSessionRow(full);
    if (!parsed) return null;

    sessionIdRef.current = parsed.id;
    try { sessionStorage.setItem(SESSION_ID_STORAGE_KEY, parsed.id); } catch { /* ignore */ }
    setSession(parsed);
    setActive(true);
    return parsed;
  }, []);

  const applyUpdate = useCallback(async (updates: Record<string, unknown>) => {
    const id = sessionIdRef.current;
    if (!id) return;
    const { data, error } = await rpc('operator_update_session', { p_session_id: id, p_updates: updates });
    if (error) {
      console.error('[copilot] operator_update_session failed:', error);
      return;
    }
    const parsed = parseSessionRow(data);
    if (parsed) setSession(prev => prev ? { ...prev, ...parsed } : parsed);
  }, []);

  const pushQueue = useCallback(async (items: QueueItem[], cursorIndex: number, batchUrl?: string) => {
    if (!sessionIdRef.current) return;
    const updates: Record<string, unknown> = {
      queue: items,
      cursor_index: cursorIndex,
      status: items.length > 0 ? 'navigating' : 'waiting',
      segment_name: items[0]?.name ?? null,
      segment_id: items[0]?.segmentId ?? null,
      destination_lat: items[0]?.lat ?? null,
      destination_lng: items[0]?.lng ?? null,
    };
    if (batchUrl) {
      const currentBatch = session?.batch_number ?? 0;
      updates.batch_url = batchUrl;
      updates.batch_number = currentBatch + 1;
    }
    await applyUpdate(updates);
  }, [applyUpdate, session?.batch_number]);

  const forceSendBatch = useCallback(async (batchUrl: string) => {
    const currentBatch = session?.batch_number ?? 0;
    await applyUpdate({ batch_url: batchUrl, batch_number: currentBatch + 1 });
  }, [applyUpdate, session?.batch_number]);

  const setBlocked = useCallback(async () => { await applyUpdate({ status: 'blocked' }); }, [applyUpdate]);
  const setWaiting = useCallback(async () => { await applyUpdate({ status: 'waiting' }); }, [applyUpdate]);

  const endSession = useCallback(async () => {
    const id = sessionIdRef.current;
    if (!id) return;
    const { error } = await rpc('operator_end_session', { p_session_id: id });
    if (error) console.error('[copilot] operator_end_session failed:', error);
    try { sessionStorage.removeItem(SESSION_ID_STORAGE_KEY); } catch { /* ignore */ }
    sessionIdRef.current = null;
    setSession(null);
    setActive(false);
  }, []);

  const generatePairing = useCallback(async (): Promise<PairingInfo | null> => {
    const id = sessionIdRef.current;
    if (!id) return null;
    const { data, error } = await rpc('operator_generate_pairing', { p_session_id: id });
    if (error || !data) {
      console.error('[copilot] operator_generate_pairing failed:', error);
      return null;
    }
    const d = data as { nonce?: string; expires_at?: string };
    if (!d.nonce || !d.expires_at) return null;
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
  };
}

/* ─── Driver side ─── */

export interface DriverState {
  status: DriverReadStatus;
  session: CopilotSession | null;
  sessionId: string | null;
  error?: string;
}

export function useCopilotDriver(driverToken: string | null) {
  const [state, setState] = useState<DriverState>({
    status: driverToken ? 'loading' : 'invalid_token',
    session: null,
    sessionId: null,
  });

  useEffect(() => {
    if (!driverToken) {
      setState({ status: 'invalid_token', session: null, sessionId: null });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      const { data, error } = await rpc('driver_read_session', { p_driver_token: driverToken });
      if (cancelled) return;
      if (error || !data) {
        setState(prev => ({ ...prev, status: 'error', error: error?.message ?? 'network' }));
        return;
      }
      const d = data as { status: DriverReadStatus; session_id?: string; session?: unknown };
      if (d.status === 'ok' && d.session) {
        const parsed = parseSessionRow(d.session);
        setState({ status: 'ok', session: parsed, sessionId: d.session_id ?? parsed?.id ?? null });
      } else {
        setState({ status: d.status, session: null, sessionId: d.session_id ?? null });
      }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, 3000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [driverToken]);

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
  };
}

/**
 * Claim a pairing nonce and persist the resulting driver_token in localStorage,
 * keyed by session_id. Returns the token + session_id on success, null on failure.
 */
export async function claimDriverPairing(nonce: string): Promise<{ driver_token: string; session_id: string } | null> {
  const { data, error } = await rpc('claim_driver_pairing', { p_nonce: nonce });
  if (error || !data) {
    console.error('[copilot] claim_driver_pairing failed:', error);
    return null;
  }
  const d = data as { driver_token?: string; session_id?: string };
  if (!d.driver_token || !d.session_id) return null;
  try {
    localStorage.setItem(`vialroute_driver_token_${d.session_id}`, d.driver_token);
    localStorage.setItem('vialroute_active_driver_session_id', d.session_id);
  } catch { /* ignore */ }
  return { driver_token: d.driver_token, session_id: d.session_id };
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

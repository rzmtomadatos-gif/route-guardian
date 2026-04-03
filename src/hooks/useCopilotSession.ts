import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Segment, LatLng } from '@/types/route';

export const QUEUE_SIZE = 5;

export interface QueueItem {
  segmentId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CopilotSession {
  id: string;
  token: string;
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
}

/** Helper: token-gated update via RPC (SECURITY DEFINER) */
async function rpcUpdate(token: string, updates: Record<string, unknown>) {
  const { error } = await supabase.rpc('update_copilot_session', {
    p_token: token,
    p_updates: updates as any,
  });
  if (error) console.error('Copilot RPC update error:', error);
  return error;
}

/* ─── Operator side ─── */

export function useCopilotOperator() {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [active, setActive] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Subscribe to own session to watch queue changes (for auto-refill)
  useEffect(() => {
    if (!session || !active) return;
    const channel = supabase
      .channel(`copilot-op-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'copilot_sessions', filter: `id=eq.${session.id}` },
        (payload) => {
          setSession(prev => {
            if (!prev) return prev;
            const raw = payload.new as any;
            return {
              ...prev,
              ...raw,
              queue: Array.isArray(raw.queue) ? raw.queue : JSON.parse(raw.queue || '[]'),
              token: prev.token,
            };
          });
        }
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [session?.id, active]);

  const createSession = useCallback(async () => {
    const { data, error } = await supabase.rpc('create_copilot_session');
    if (error) { console.error('Copilot create error:', error); return null; }
    const raw = data as any;
    const s = { ...raw, queue: Array.isArray(raw.queue) ? raw.queue : JSON.parse(raw.queue || '[]') } as CopilotSession;
    setSession(s);
    setActive(true);
    return s;
  }, []);

  const updateDestination = useCallback(async (segment: Segment, trackNumber?: number | null) => {
    if (!session) return;
    const start = segment.coordinates[0];
    await rpcUpdate(session.token, {
      segment_name: segment.name,
      segment_id: segment.id,
      destination_lat: start.lat,
      destination_lng: start.lng,
      status: 'navigating',
      track_number: trackNumber ?? null,
    });
  }, [session]);

  /** Push a batch of destinations into the queue and generate batch URL */
  const pushQueue = useCallback(async (items: QueueItem[], cursorIndex: number, batchUrl?: string) => {
    if (!session) return;
    const newBatchNumber = (session.batch_number || 0) + (batchUrl ? 1 : 0);
    await rpcUpdate(session.token, {
      queue: items,
      cursor_index: cursorIndex,
      status: items.length > 0 ? 'navigating' : 'waiting',
      segment_name: items[0]?.name ?? null,
      segment_id: items[0]?.segmentId ?? null,
      destination_lat: items[0]?.lat ?? null,
      destination_lng: items[0]?.lng ?? null,
      batch_url: batchUrl ?? session.batch_url,
      batch_number: newBatchNumber,
    });

    setSession(prev => prev ? { ...prev, queue: items, cursor_index: cursorIndex, batch_url: batchUrl ?? prev.batch_url, batch_number: newBatchNumber } : prev);
  }, [session]);

  /** Force send a new batch URL to the driver */
  const forceSendBatch = useCallback(async (batchUrl: string) => {
    if (!session) return;
    const newBatchNumber = (session.batch_number || 0) + 1;
    await rpcUpdate(session.token, {
      batch_url: batchUrl,
      batch_number: newBatchNumber,
    });
    setSession(prev => prev ? { ...prev, batch_url: batchUrl, batch_number: newBatchNumber } : prev);
  }, [session]);

  const setBlocked = useCallback(async () => {
    if (!session) return;
    await rpcUpdate(session.token, { status: 'blocked' });
  }, [session]);

  const setWaiting = useCallback(async () => {
    if (!session) return;
    await rpcUpdate(session.token, { status: 'waiting' });
  }, [session]);

  const endSession = useCallback(async () => {
    if (!session) return;
    await rpcUpdate(session.token, { status: 'ended', queue: [] });
    setActive(false);
    setSession(null);
  }, [session]);

  return { session, active, createSession, updateDestination, pushQueue, forceSendBatch, setBlocked, setWaiting, endSession };
}

/* ─── Driver side ─── */

export function useCopilotDriver(token: string | null) {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const parseSession = (raw: any): CopilotSession => ({
    ...raw,
    queue: Array.isArray(raw.queue) ? raw.queue : JSON.parse(raw.queue || '[]'),
  });

  useEffect(() => {
    if (!token) { setLoading(false); return; }

    supabase
      .rpc('read_copilot_session_by_token', { p_token: token })
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError('Sesión no encontrada');
          setLoading(false);
          return;
        }
        const raw = typeof data === 'string' ? JSON.parse(data) : data;
        setSession(parseSession(raw));
        setLoading(false);

        const channel = supabase
          .channel(`copilot-${raw.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'copilot_sessions', filter: `id=eq.${raw.id}` },
            (payload) => {
              setSession(prev => {
                const parsed = parseSession(payload.new);
                if (!prev) return parsed;
                return { ...prev, ...parsed, token: prev.token };
              });
            }
          )
          .subscribe();
        channelRef.current = channel;
      });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [token]);

  /** Advance queue: shift current, update DB */
  const advanceQueue = useCallback(async () => {
    if (!session || session.queue.length <= 1) return null;
    const newQueue = session.queue.slice(1);
    const next = newQueue[0];
    const newCursor = session.cursor_index + 1;

    await rpcUpdate(session.token, {
      queue: newQueue,
      cursor_index: newCursor,
      segment_name: next?.name ?? null,
      segment_id: next?.segmentId ?? null,
      destination_lat: next?.lat ?? null,
      destination_lng: next?.lng ?? null,
    });

    // Return next destination for immediate nav opening
    return next ?? null;
  }, [session]);

  return { session, loading, error, advanceQueue };
}

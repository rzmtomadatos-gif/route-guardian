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
    const { data, error } = await supabase
      .from('copilot_sessions')
      .insert({ status: 'waiting', queue: [], cursor_index: 0 })
      .select()
      .single();
    if (error) { console.error('Copilot create error:', error); return null; }
    const s = { ...data, queue: (Array.isArray(data.queue) ? data.queue : []) as unknown as QueueItem[] } as CopilotSession;
    setSession(s);
    setActive(true);
    return s;
  }, []);

  const updateDestination = useCallback(async (segment: Segment, trackNumber?: number | null) => {
    if (!session) return;
    const start = segment.coordinates[0];
    await supabase
      .from('copilot_sessions')
      .update({
        segment_name: segment.name,
        segment_id: segment.id,
        destination_lat: start.lat,
        destination_lng: start.lng,
        status: 'navigating',
        track_number: trackNumber ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);
  }, [session]);

  /** Push a batch of destinations into the queue */
  const pushQueue = useCallback(async (items: QueueItem[], cursorIndex: number) => {
    if (!session) return;
    await supabase
      .from('copilot_sessions')
      .update({
        queue: items as any,
        cursor_index: cursorIndex,
        status: items.length > 0 ? 'navigating' : 'waiting',
        // Set current destination to first in queue
        segment_name: items[0]?.name ?? null,
        segment_id: items[0]?.segmentId ?? null,
        destination_lat: items[0]?.lat ?? null,
        destination_lng: items[0]?.lng ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    setSession(prev => prev ? { ...prev, queue: items, cursor_index: cursorIndex } : prev);
  }, [session]);

  const setBlocked = useCallback(async () => {
    if (!session) return;
    await supabase
      .from('copilot_sessions')
      .update({ status: 'blocked', updated_at: new Date().toISOString() })
      .eq('id', session.id);
  }, [session]);

  const setWaiting = useCallback(async () => {
    if (!session) return;
    await supabase
      .from('copilot_sessions')
      .update({ status: 'waiting', updated_at: new Date().toISOString() })
      .eq('id', session.id);
  }, [session]);

  const endSession = useCallback(async () => {
    if (!session) return;
    await supabase
      .from('copilot_sessions')
      .update({ status: 'ended', queue: [], updated_at: new Date().toISOString() })
      .eq('id', session.id);
    setActive(false);
    setSession(null);
  }, [session]);

  return { session, active, createSession, updateDestination, pushQueue, setBlocked, setWaiting, endSession };
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
      .from('copilot_sessions')
      .select('*')
      .eq('token', token)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError('Sesión no encontrada');
          setLoading(false);
          return;
        }
        setSession(parseSession(data));
        setLoading(false);

        const channel = supabase
          .channel(`copilot-${data.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'copilot_sessions', filter: `id=eq.${data.id}` },
            (payload) => {
              setSession(parseSession(payload.new));
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

    await supabase
      .from('copilot_sessions')
      .update({
        queue: newQueue as any,
        cursor_index: newCursor,
        segment_name: next?.name ?? null,
        segment_id: next?.segmentId ?? null,
        destination_lat: next?.lat ?? null,
        destination_lng: next?.lng ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    // Return next destination for immediate nav opening
    return next ?? null;
  }, [session]);

  return { session, loading, error, advanceQueue };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Segment, LatLng } from '@/types/route';

export interface CopilotSession {
  id: string;
  token: string;
  segment_name: string | null;
  segment_id: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  status: string;
  track_number: number | null;
}

/* ─── Operator side ─── */

export function useCopilotOperator() {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [active, setActive] = useState(false);

  const createSession = useCallback(async () => {
    const { data, error } = await supabase
      .from('copilot_sessions')
      .insert({ status: 'waiting' })
      .select()
      .single();
    if (error) { console.error('Copilot create error:', error); return null; }
    setSession(data as CopilotSession);
    setActive(true);
    return data as CopilotSession;
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
      .update({ status: 'ended', updated_at: new Date().toISOString() })
      .eq('id', session.id);
    setActive(false);
    setSession(null);
  }, [session]);

  return { session, active, createSession, updateDestination, setBlocked, setWaiting, endSession };
}

/* ─── Driver side ─── */

export function useCopilotDriver(token: string | null) {
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }

    // Initial fetch
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
        setSession(data as CopilotSession);
        setLoading(false);

        // Subscribe to realtime changes
        const channel = supabase
          .channel(`copilot-${data.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'copilot_sessions', filter: `id=eq.${data.id}` },
            (payload) => {
              setSession(payload.new as CopilotSession);
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

  return { session, loading, error };
}

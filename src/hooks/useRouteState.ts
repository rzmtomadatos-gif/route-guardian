import { useState, useCallback, useEffect } from 'react';
import type { Route, Segment, Incident, AppState, IncidentCategory, LatLng } from '@/types/route';
import { loadState, saveState } from '@/utils/storage';
import { optimizeRoute } from '@/utils/route-optimizer';

export function useRouteState() {
  const [state, setStateRaw] = useState<AppState>(loadState);

  const setState = useCallback((updater: (prev: AppState) => AppState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      saveState(next);
      return next;
    });
  }, []);

  const setRoute = useCallback((route: Route) => {
    const optimizedOrder = optimizeRoute(route.segments);
    setState((s) => ({
      ...s,
      route: { ...route, optimizedOrder },
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
    }));
  }, [setState]);

  const startNavigation = useCallback(() => {
    setState((s) => {
      if (!s.route) return s;
      const pendingSegments = s.route.optimizedOrder.filter((id) => {
        const seg = s.route!.segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente';
      });
      return {
        ...s,
        navigationActive: true,
        activeSegmentId: pendingSegments[0] || null,
      };
    });
  }, [setState]);

  const stopNavigation = useCallback(() => {
    setState((s) => ({ ...s, navigationActive: false, activeSegmentId: null }));
  }, [setState]);

  const confirmStartSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, status: 'en_progreso' as const } : seg
      );
      return { ...s, route: { ...s.route, segments }, activeSegmentId: segmentId };
    });
  }, [setState]);

  const completeSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, status: 'completado' as const } : seg
      );
      const currentIdx = s.route.optimizedOrder.indexOf(segmentId);
      const remaining = s.route.optimizedOrder.slice(currentIdx + 1).filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente';
      });
      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: remaining[0] || null,
      };
    });
  }, [setState]);

  const addIncident = useCallback((segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => {
    setState((s) => ({
      ...s,
      incidents: [
        ...s.incidents,
        {
          id: Math.random().toString(36).substring(2, 10),
          segmentId,
          category,
          note,
          timestamp: new Date().toISOString(),
          location,
        },
      ],
    }));
  }, [setState]);

  const reoptimize = useCallback((currentPos?: LatLng | null) => {
    setState((s) => {
      if (!s.route) return s;
      const pending = s.route.segments.filter((seg) => seg.status === 'pendiente');
      const completed = s.route.segments.filter((seg) => seg.status !== 'pendiente');
      const newOrder = [
        ...completed.map((s) => s.id),
        ...optimizeRoute(pending, currentPos),
      ];
      return { ...s, route: { ...s.route, optimizedOrder: newOrder } };
    });
  }, [setState]);

  const clearRoute = useCallback(() => {
    setState(() => ({
      route: null,
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
      currentPosition: null,
    }));
  }, [setState]);

  return {
    state,
    setRoute,
    startNavigation,
    stopNavigation,
    confirmStartSegment,
    completeSegment,
    addIncident,
    reoptimize,
    clearRoute,
  };
}

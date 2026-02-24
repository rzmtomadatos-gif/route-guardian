import { useState, useCallback, useRef } from 'react';
import type { Route, AppState, Segment, Incident, IncidentCategory, LatLng, BaseLocation } from '@/types/route';
import { loadState, saveState } from '@/utils/storage';
import { optimizeRoute } from '@/utils/route-optimizer';
import { optimizeWithDirections } from '@/utils/google-directions';

export function useRouteState() {
  const [state, setStateRaw] = useState<AppState>(loadState);
  const completedCountRef = useRef(0);

  const setState = useCallback((updater: (prev: AppState) => AppState) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      saveState(next);
      return next;
    });
  }, []);

  const setRoute = useCallback(async (route: Route) => {
    // Start with nearest-neighbor fallback
    const fallbackOrder = optimizeRoute(route.segments);
    setState((s) => ({
      ...s,
      route: { ...route, optimizedOrder: fallbackOrder },
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
    }));

    // Try Google Directions API optimization
    try {
      const endpoints = route.segments.map((seg) => ({
        id: seg.id,
        start: seg.coordinates[0],
        end: seg.coordinates[seg.coordinates.length - 1],
      }));
      const directionsOrder = await optimizeWithDirections(endpoints);
      if (directionsOrder) {
        setState((s) => {
          if (!s.route || s.route.id !== route.id) return s;
          return { ...s, route: { ...s.route, optimizedOrder: directionsOrder } };
        });
      }
    } catch (e) {
      console.warn('Google Directions optimization failed, using local algorithm:', e);
    }
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
      // Calculate next track number: max of all assigned + all history + 1
      const allTrackNumbers = s.route.segments.flatMap((seg) => [
        ...(seg.trackNumber !== null ? [seg.trackNumber] : []),
        ...seg.trackHistory,
      ]);
      const nextTrack = allTrackNumbers.length > 0 ? Math.max(...allTrackNumbers) + 1 : 1;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, status: 'en_progreso' as const, trackNumber: nextTrack } : seg
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

      // Track completed count for auto-reoptimize every 6
      completedCountRef.current += 1;
      const shouldReoptimize = completedCountRef.current % 6 === 0;

      const pending = segments.filter((seg) => seg.status === 'pendiente');

      if (shouldReoptimize && pending.length > 0) {
        const newOrder = [
          ...segments.filter((seg) => seg.status !== 'pendiente').map((seg) => seg.id),
          ...optimizeRoute(pending, s.base?.position || s.currentPosition),
        ];
        return {
          ...s,
          route: { ...s.route, segments, optimizedOrder: newOrder },
          activeSegmentId: pending.length > 0 ? newOrder.find((id) => pending.some((p) => p.id === id)) || null : null,
        };
      }

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
      const basePos = currentPos || s.base?.position || null;
      const pending = s.route.segments.filter((seg) => seg.status === 'pendiente');
      const completed = s.route.segments.filter((seg) => seg.status !== 'pendiente');
      const newOrder = [
        ...completed.map((s) => s.id),
        ...optimizeRoute(pending, basePos),
      ];
      return { ...s, route: { ...s.route, optimizedOrder: newOrder } };
    });
  }, [setState]);

  const resetSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        // Save current track to history if it was assigned
        const newHistory = seg.trackNumber !== null
          ? [...seg.trackHistory, seg.trackNumber]
          : seg.trackHistory;
        return { ...seg, status: 'pendiente' as const, trackNumber: null, trackHistory: newHistory };
      });
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const clearRoute = useCallback(() => {
    setState((s) => ({
      route: null,
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
      currentPosition: null,
      base: s.base, // preserve base
    }));
  }, [setState]);

  const setActiveSegment = useCallback((segmentId: string) => {
    setState((s) => ({ ...s, activeSegmentId: segmentId }));
  }, [setState]);

  const setBase = useCallback((base: BaseLocation) => {
    setState((s) => ({ ...s, base }));
  }, [setState]);

  const updateSegment = useCallback((segmentId: string, updates: Partial<Segment>) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, ...updates } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const updateIncident = useCallback((incidentId: string, updates: Partial<Incident>) => {
    setState((s) => ({
      ...s,
      incidents: s.incidents.map((inc) =>
        inc.id === incidentId ? { ...inc, ...updates } : inc
      ),
    }));
  }, [setState]);

  const deleteIncident = useCallback((incidentId: string) => {
    setState((s) => ({
      ...s,
      incidents: s.incidents.filter((inc) => inc.id !== incidentId),
    }));
  }, [setState]);

  const addLayer = useCallback((layerName: string) => {
    // Layers are implicit (derived from segments), nothing to store separately.
    // This is a no-op placeholder; segments are assigned via moveSegmentToLayer.
  }, []);

  const renameLayer = useCallback((oldName: string, newName: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.layer === oldName ? { ...seg, layer: newName } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const deleteLayer = useCallback((layerName: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.layer === layerName ? { ...seg, layer: undefined } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const moveSegmentToLayer = useCallback((segmentId: string, layerName: string | undefined) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, layer: layerName } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const mergeSegments = useCallback((segmentIds: string[]) => {
    setState((s) => {
      if (!s.route || segmentIds.length < 2) return s;
      const toMerge = segmentIds
        .map((id) => s.route!.segments.find((seg) => seg.id === id))
        .filter(Boolean) as import('@/types/route').Segment[];
      if (toMerge.length < 2) return s;

      // Merge coordinates in order
      const mergedCoords = toMerge.flatMap((seg) => seg.coordinates);
      const first = toMerge[0];
      const merged: import('@/types/route').Segment = {
        ...first,
        id: Math.random().toString(36).substring(2, 10),
        name: toMerge.map((s) => s.name).join(' + '),
        coordinates: mergedCoords,
        notes: toMerge.map((s) => s.notes).filter(Boolean).join(' | '),
        trackNumber: null,
        trackHistory: [],
        status: 'pendiente',
      };

      const mergeSet = new Set(segmentIds);
      const segments = s.route.segments.filter((seg) => !mergeSet.has(seg.id));
      // Insert merged segment at position of first original
      const insertIdx = s.route.segments.findIndex((seg) => seg.id === segmentIds[0]);
      segments.splice(Math.max(0, insertIdx), 0, merged);

      const optimizedOrder = s.route.optimizedOrder
        .filter((id) => !mergeSet.has(id))
        .concat(merged.id);

      return {
        ...s,
        route: { ...s.route, segments, optimizedOrder },
        incidents: s.incidents.map((inc) =>
          mergeSet.has(inc.segmentId) ? { ...inc, segmentId: merged.id } : inc
        ),
      };
    });
  }, [setState]);

  const addSegment = useCallback((segment: import('@/types/route').Segment) => {
    setState((s) => {
      if (!s.route) return s;
      return {
        ...s,
        route: {
          ...s.route,
          segments: [...s.route.segments, segment],
          optimizedOrder: [...s.route.optimizedOrder, segment.id],
        },
      };
    });
  }, [setState]);

  const deleteSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      return {
        ...s,
        route: {
          ...s.route,
          segments: s.route.segments.filter((seg) => seg.id !== segmentId),
          optimizedOrder: s.route.optimizedOrder.filter((id) => id !== segmentId),
        },
        incidents: s.incidents.filter((inc) => inc.segmentId !== segmentId),
        activeSegmentId: s.activeSegmentId === segmentId ? null : s.activeSegmentId,
      };
    });
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
    resetSegment,
    clearRoute,
    setActiveSegment,
    setBase,
    updateSegment,
    updateIncident,
    deleteIncident,
    addLayer,
    renameLayer,
    deleteLayer,
    moveSegmentToLayer,
    mergeSegments,
    addSegment,
    deleteSegment,
  };
}

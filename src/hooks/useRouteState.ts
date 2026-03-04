import { useState, useCallback } from 'react';
import type { Route, AppState, Segment, Incident, IncidentCategory, LatLng, BaseLocation } from '@/types/route';
import { loadState, saveState } from '@/utils/storage';
import { optimizeRoute } from '@/utils/route-optimizer';
import { optimizeWithDirections } from '@/utils/google-directions';

const MAX_SEGMENTS_PER_TRACK = 9;

export function useRouteState() {
  const [state, setStateRaw] = useState<AppState>(loadState);
  
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);

  const setState = useCallback((updater: (prev: AppState) => AppState, immediate = false) => {
    setStateRaw((prev) => {
      const next = updater(prev);
      saveState(next, immediate);
      setIsDirty(true);
      return next;
    });
  }, []);

  /** Get current max track number across all segments */
  const getMaxTrack = (segments: Segment[]): number => {
    const all = segments.flatMap((seg) => [
      ...(seg.trackNumber !== null ? [seg.trackNumber] : []),
      ...seg.trackHistory,
    ]);
    return all.length > 0 ? Math.max(...all) : 0;
  };

  /** Count how many segments are assigned to a given track number */
  const countSegmentsInTrack = (segments: Segment[], trackNum: number): number => {
    return segments.filter((seg) => seg.trackNumber === trackNum && (seg.status === 'en_progreso' || seg.status === 'completado')).length;
  };

  const setRoute = useCallback(async (route: Route) => {
    const fallbackOrder = optimizeRoute(route.segments);
    setState((s) => ({
      ...s,
      route: { ...route, optimizedOrder: fallbackOrder },
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
    }));

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

  const startNavigation = useCallback((hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      const pendingSegments = s.route.optimizedOrder.filter((id) => {
        const seg = s.route!.segments.find((seg) => seg.id === id);
        if (!seg || seg.status !== 'pendiente') return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
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

  const confirmStartSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;

      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      if (!seg) return s;

      // If the segment already has a plannedTrackNumber, use it as the real track
      let nextTrack: number;
      if (seg.plannedTrackNumber !== null && seg.plannedTrackNumber !== undefined) {
        nextTrack = seg.plannedTrackNumber;
      } else {
        const maxTrack = getMaxTrack(s.route.segments);
        if (maxTrack === 0) {
          nextTrack = 1;
        } else {
          const countInCurrent = countSegmentsInTrack(s.route.segments, maxTrack);
          if (countInCurrent >= MAX_SEGMENTS_PER_TRACK) {
            nextTrack = maxTrack + 1;
          } else if (s.rstMode && s.rstGroupSize > 0) {
            const assignedCount = s.route.segments.filter((seg) => seg.trackNumber !== null).length;
            if (assignedCount > 0 && assignedCount % s.rstGroupSize !== 0) {
              nextTrack = maxTrack;
            } else {
              nextTrack = maxTrack + 1;
            }
          } else {
            nextTrack = maxTrack + 1;
          }
        }
      }

      const currentIdx = s.route.optimizedOrder.indexOf(segmentId);

      // Start this segment – assign real trackNumber
      let segments = s.route.segments.map((seg) =>
        seg.id === segmentId
          ? { ...seg, status: 'en_progreso' as const, trackNumber: nextTrack, plannedTrackNumber: null, plannedBy: undefined, timestampInicio: new Date().toISOString() }
          : seg
      );

      // RST: pre-assign plannedTrackNumber (NOT trackNumber) to next visible pending siblings
      if (s.rstMode && s.rstGroupSize > 1 && currentIdx >= 0) {
        let assigned = 0;
        const maxToAssign = s.rstGroupSize - 1;
        for (let i = currentIdx + 1; i < s.route.optimizedOrder.length && assigned < maxToAssign; i++) {
          const sibId = s.route.optimizedOrder[i];
          const sib = segments.find((seg) => seg.id === sibId);
          if (!sib || sib.status !== 'pendiente') continue;
          // Skip segments in hidden layers
          if (hiddenLayers && sib.layer && hiddenLayers.has(sib.layer)) continue;
          if (sib.trackNumber === null && (sib.plannedTrackNumber === null || sib.plannedTrackNumber === undefined)) {
            segments = segments.map((seg) =>
              seg.id === sibId ? { ...seg, plannedTrackNumber: nextTrack, plannedBy: 'rst' as const } : seg
            );
            assigned++;
          }
        }
      }

      return { ...s, route: { ...s.route, segments }, activeSegmentId: segmentId };
    }, true);
  }, [setState]);

  const completeSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;

      const now = new Date().toISOString();

      // Only complete THIS segment – no RST auto-complete
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          status: 'completado' as const,
          timestampFin: now,
          timestampInicio: seg.timestampInicio || now,
        };
      });

      // Next pending according to optimizedOrder, respecting hidden layers
      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        if (!seg || seg.status !== 'pendiente') return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      });

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: remaining[0] || null,
      };
    }, true);
  }, [setState]);

  /** Mark segment as posible_repetir (called when adding an incident) */
  const markPosibleRepetir = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        // Save current track to history
        const newHistory = seg.trackNumber !== null
          ? [...seg.trackHistory, seg.trackNumber]
          : seg.trackHistory;
        return {
          ...seg,
          status: 'posible_repetir' as const,
          trackNumber: null,
          trackHistory: newHistory,
          timestampFin: new Date().toISOString(),
        };
      });

      // Move to next pending
      const currentIdx = s.route.optimizedOrder.indexOf(segmentId);
      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente';
      });

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: remaining[0] || null,
      };
    }, true);
  }, [setState]);

  /** Explicit repeat: reset posible_repetir segment to pendiente so it can be recorded again */
  const repeatSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          status: 'pendiente' as const,
          trackNumber: null,
          plannedTrackNumber: null,
          plannedBy: undefined,
          timestampInicio: undefined,
          timestampFin: undefined,
        };
      });
      return { ...s, route: { ...s.route, segments } };
    }, true);
  }, [setState]);

  /** Severe categories that suggest the segment may need repeating */
  const SEVERE_CATEGORIES = new Set<IncidentCategory>([
    'carretera_cortada', 'acceso_imposible', 'obstaculo', 'inundacion',
  ]);

  const addIncident = useCallback((segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => {
    setState((s) => {
      if (!s.route) return { ...s };
      const newIncident = {
        id: Math.random().toString(36).substring(2, 10),
        segmentId,
        category,
        note,
        timestamp: new Date().toISOString(),
        location,
      };

      // For severe incidents, mark as posible_repetir (but do NOT auto-repeat)
      const isSevere = SEVERE_CATEGORIES.has(category);
      const segments = isSevere
        ? s.route.segments.map((seg) => {
            if (seg.id !== segmentId) return seg;
            if (seg.status === 'completado' || seg.status === 'posible_repetir') return seg;
            return { ...seg, status: 'posible_repetir' as const };
          })
        : s.route.segments;

      return {
        ...s,
        route: { ...s.route, segments },
        incidents: [...s.incidents, newIncident],
      };
    });
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
        const newHistory = seg.trackNumber !== null
          ? [...seg.trackHistory, seg.trackNumber]
          : seg.trackHistory;
        return {
          ...seg,
          status: 'pendiente' as const,
          trackNumber: null,
          plannedTrackNumber: null,
          plannedBy: undefined,
          trackHistory: newHistory,
          timestampInicio: undefined,
          timestampFin: undefined,
        };
      });
      return { ...s, route: { ...s.route, segments } };
    }, true);
  }, [setState]);

  const clearRoute = useCallback(() => {
    setState((s) => ({
      route: null,
      incidents: [],
      activeSegmentId: null,
      navigationActive: false,
      currentPosition: null,
      base: s.base,
      rstMode: s.rstMode,
      rstGroupSize: s.rstGroupSize,
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
    setState((s) => {
      if (!s.route) return s;
      const exists = s.route.segments.some((seg) => seg.layer === layerName);
      if (exists) return s;
      const availableLayers = [...(s.route.availableLayers || []), layerName];
      return { ...s, route: { ...s.route, availableLayers } };
    });
  }, [setState]);

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
      const availableLayers = (s.route.availableLayers || []).filter((l) => l !== layerName);
      return { ...s, route: { ...s.route, segments, availableLayers } };
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
        .filter(Boolean) as Segment[];
      if (toMerge.length < 2) return s;

      const mergedCoords = toMerge.flatMap((seg) => seg.coordinates);
      const first = toMerge[0];
      const merged: Segment = {
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

  const addSegment = useCallback((segment: Segment) => {
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

  const bulkDeleteSegments = useCallback((segmentIds: string[]) => {
    setState((s) => {
      if (!s.route) return s;
      const idSet = new Set(segmentIds);
      return {
        ...s,
        route: {
          ...s.route,
          segments: s.route.segments.filter((seg) => !idSet.has(seg.id)),
          optimizedOrder: s.route.optimizedOrder.filter((id) => !idSet.has(id)),
        },
        incidents: s.incidents.filter((inc) => !idSet.has(inc.segmentId)),
        activeSegmentId: s.activeSegmentId && idSet.has(s.activeSegmentId) ? null : s.activeSegmentId,
      };
    });
  }, [setState]);

  const bulkMoveToLayer = useCallback((segmentIds: string[], layerName: string | undefined) => {
    setState((s) => {
      if (!s.route) return s;
      const idSet = new Set(segmentIds);
      const segments = s.route.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, layer: layerName } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const bulkSetColor = useCallback((segmentIds: string[], color: string) => {
    setState((s) => {
      if (!s.route) return s;
      const idSet = new Set(segmentIds);
      const segments = s.route.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, color } : seg
      );
      return { ...s, route: { ...s.route, segments } };
    });
  }, [setState]);

  const duplicateSegments = useCallback((segmentIds: string[]) => {
    setState((s) => {
      if (!s.route) return s;
      const newSegments: Segment[] = [];
      segmentIds.forEach((id) => {
        const orig = s.route!.segments.find((seg) => seg.id === id);
        if (orig) {
          newSegments.push({
            ...orig,
            id: Math.random().toString(36).substring(2, 10),
            name: orig.name + ' (copia)',
            trackNumber: null,
            trackHistory: [],
            status: 'pendiente',
          });
        }
      });
      return {
        ...s,
        route: {
          ...s.route,
          segments: [...s.route.segments, ...newSegments],
          optimizedOrder: [...s.route.optimizedOrder, ...newSegments.map((seg) => seg.id)],
        },
      };
    });
  }, [setState]);

  const reorderSegment = useCallback((segmentId: string, direction: 'up' | 'down') => {
    setState((s) => {
      if (!s.route) return s;
      const segs = [...s.route.segments];
      const idx = segs.findIndex((seg) => seg.id === segmentId);
      if (idx < 0) return s;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= segs.length) return s;
      [segs[idx], segs[newIdx]] = [segs[newIdx], segs[idx]];
      return { ...s, route: { ...s.route, segments: segs } };
    });
  }, [setState]);

  const simplifySegments = useCallback(() => {
    setState((s) => {
      if (!s.route) return s;
      const groups = new Map<string, Segment[]>();
      for (const seg of s.route.segments) {
        const key = `${seg.name}|||${seg.direction}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(seg);
      }

      const newSegments: Segment[] = [];
      const removedIds = new Set<string>();

      for (const [, group] of groups) {
        if (group.length < 2) {
          newSegments.push(group[0]);
          continue;
        }
        const first = group[0];
        const mergedCoords = group.flatMap((seg) => seg.coordinates);
        const merged: Segment = {
          ...first,
          id: Math.random().toString(36).substring(2, 10),
          coordinates: mergedCoords,
          notes: group.map((s) => s.notes).filter(Boolean).join(' | '),
          trackNumber: null,
          trackHistory: [],
          status: 'pendiente',
        };
        newSegments.push(merged);
        group.forEach((seg) => removedIds.add(seg.id));
      }

      const optimizedOrder = s.route.optimizedOrder
        .filter((id) => !removedIds.has(id))
        .concat(newSegments.filter((seg) => !s.route!.optimizedOrder.includes(seg.id)).map((seg) => seg.id));

      return {
        ...s,
        route: { ...s.route, segments: newSegments, optimizedOrder },
        incidents: s.incidents.map((inc) => {
          if (!removedIds.has(inc.segmentId)) return inc;
          const orig = s.route!.segments.find((seg) => seg.id === inc.segmentId);
          if (!orig) return inc;
          const replacement = newSegments.find(
            (seg) => seg.name === orig.name && seg.direction === orig.direction && !s.route!.segments.some((o) => o.id === seg.id)
          );
          return replacement ? { ...inc, segmentId: replacement.id } : inc;
        }),
      };
    });
  }, [setState]);

  const markClean = useCallback(() => {
    setIsDirty(false);
  }, []);

  const setRstMode = useCallback((enabled: boolean) => {
    setState((s) => ({ ...s, rstMode: enabled }));
  }, [setState]);

  const setRstGroupSize = useCallback((size: number) => {
    setState((s) => ({ ...s, rstGroupSize: size }));
  }, [setState]);

  return {
    state,
    isDirty,
    markClean,
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
    bulkDeleteSegments,
    bulkMoveToLayer,
    bulkSetColor,
    duplicateSegments,
    reorderSegment,
    simplifySegments,
    setRstMode,
    setRstGroupSize,
    markPosibleRepetir,
    repeatSegment,
  };
}

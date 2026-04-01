import { useState, useCallback } from 'react';
import type { Route, AppState, Segment, Incident, IncidentCategory, IncidentImpact, LatLng, BaseLocation, TrackSession, BlockEndPrompt } from '@/types/route';
import { getDefaultState, saveState } from '@/utils/storage';
import { optimizeRoute } from '@/utils/route-optimizer';
import { optimizeWithDirections } from '@/utils/google-directions';
import { logEvent } from '@/utils/persistence';

const MAX_SEGMENTS_PER_TRACK = 9;

/** Categories that are "Critica NO grabable" by default */
const NON_RECORDABLE_CATEGORIES = new Set<IncidentCategory>([
  'carretera_cortada', 'acceso_imposible', 'inundacion', 'lluvia',
]);

/** Categories that invalidate the entire block */
const BLOCK_INVALIDATING_CATEGORIES = new Set<IncidentCategory>([
  'error_sistema_pc360', 'error_sistema_pc2', 'error_sistema_linux',
]);

export function useRouteState() {
  const [state, setStateRaw] = useState<AppState>(getDefaultState);
  
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

  /** Get current max track number for a given work day across segments + track session */
  const getMaxTrack = (segments: Segment[], trackSession: TrackSession | null, workDay?: number): number => {
    const daySegments = workDay != null
      ? segments.filter((seg) => seg.workDay === workDay)
      : segments;
    const all = daySegments.flatMap((seg) => [
      ...(seg.trackNumber !== null ? [seg.trackNumber] : []),
      ...seg.trackHistory,
    ]);
    if (trackSession) all.push(trackSession.trackNumber);
    return all.length > 0 ? Math.max(...all) : 0;
  };

  /** Count how many segments are assigned to a given track number (real, valid) */
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
      trackSession: null,
    }));

    logEvent('ROUTE_LOADED', {
      payload: {
        routeId: route.id,
        routeName: route.name,
        segmentCount: route.segments.length,
        layerCount: route.availableLayers?.length ?? 0,
      },
    });

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
        if (seg.nonRecordable) return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      });
      return {
        ...s,
        navigationActive: true,
        activeSegmentId: pendingSegments[0] || null,
        trackSession: s.trackSession
          ? { ...s.trackSession, trackStartTime: s.acquisitionMode === 'GARMIN' ? Date.now() : s.trackSession.trackStartTime }
          : s.acquisitionMode === 'GARMIN'
            ? { active: false, trackNumber: 0, capacity: 9, segmentIds: [], startedAt: null, endedAt: null, closedManually: false, trackStartTime: Date.now() }
            : null,
      };
    });
    logEvent('NAV_STARTED', { payload: { mode: 'navigation' } });
  }, [setState]);

  const stopNavigation = useCallback(() => {
    setState((s) => ({
      ...s,
      navigationActive: false,
      activeSegmentId: null,
      trackSession: s.trackSession
        ? { ...s.trackSession, trackStartTime: null }
        : null,
    }));
    logEvent('NAV_STOPPED');
  }, [setState]);

  /** Allocate the next track number based on mode. Resets per workDay. */
  const allocateTrackNumber = (segments: Segment[], rstMode: boolean, groupLimit: number, trackSession: TrackSession | null, workDay?: number): number => {
    if (!rstMode) {
      // RST OFF: every segment gets a unique track = max + 1
      const maxTrack = getMaxTrack(segments, trackSession, workDay);
      return maxTrack + 1;
    }
    // RST ON: reuse current track if session active and has room
    if (trackSession && trackSession.active && trackSession.segmentIds.length < trackSession.capacity) {
      return trackSession.trackNumber;
    }
    // Otherwise new track
    const maxTrack = getMaxTrack(segments, trackSession, workDay);
    return maxTrack + 1;
  };

  /** Skip segment: leave as pendiente and move to next */
  const skipSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      if (s.blockEndPrompt.isOpen) return s;
      const segments = s.route.segments;
      const remaining = s.route.optimizedOrder.filter((id) => {
        if (id === segmentId) return false;
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente' && !seg.nonRecordable &&
          !(hiddenLayers && seg.layer && hiddenLayers.has(seg.layer));
      });
      return { ...s, activeSegmentId: remaining[0] || null };
    });
    logEvent('SEGMENT_SKIPPED', { segmentId });
  }, [setState]);

  const confirmStartSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      // Guard: block if end-of-video prompt is open
      if (s.blockEndPrompt.isOpen) return s;

      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      if (!seg) return s;

      const groupLimit = s.rstMode && s.rstGroupSize > 0 ? s.rstGroupSize : 1;
      const now = new Date().toISOString();

      let trackSession = s.trackSession;

      // Close full session if needed
      if (trackSession && trackSession.active && trackSession.segmentIds.length >= trackSession.capacity) {
        trackSession = { ...trackSession, active: false, endedAt: now };
      }
      // Close session if not in RST mode (each segment = new track)
      if (!s.rstMode && trackSession && trackSession.active) {
        trackSession = { ...trackSession, active: false, endedAt: now };
      }

      const nextTrack = allocateTrackNumber(s.route.segments, s.rstMode, groupLimit, trackSession && trackSession.active ? trackSession : null, s.workDay);

      // Create or update track session
      if (!trackSession || !trackSession.active) {
        trackSession = {
          active: true,
          trackNumber: nextTrack,
          capacity: groupLimit,
          segmentIds: [segmentId],
          startedAt: now,
          endedAt: null,
          closedManually: false,
          trackStartTime: s.trackSession?.trackStartTime ?? Date.now(),
        };
      } else {
        trackSession = {
          ...trackSession,
          segmentIds: [...trackSession.segmentIds, segmentId],
        };
      }

      // Compute segmentOrder: count only segments in the SAME workDay + trackNumber
      const existingInTrack = s.route.segments.filter(
        (seg) =>
          seg.id !== segmentId &&
          seg.workDay === s.workDay &&
          seg.trackNumber === nextTrack &&
          (seg.status === 'en_progreso' || seg.status === 'completado') &&
          !seg.nonRecordable
      ).length;
      const segmentOrder = existingInTrack + 1;

      // Hard guard: in RST mode, segmentOrder must not exceed block capacity
      if (s.rstMode && segmentOrder > groupLimit) {
        console.warn('Invalid segmentOrder detected', {
          workDay: s.workDay,
          trackNumber: nextTrack,
          segmentOrder,
          groupLimit,
          segmentId,
        });
        return s;
      }

      const currentIdx = s.route.optimizedOrder.indexOf(segmentId);

      // Garmin mode: compute segmentStartSeconds relative to track start
      const garminStart = s.acquisitionMode === 'GARMIN' && trackSession.trackStartTime
        ? Math.round((Date.now() - trackSession.trackStartTime) / 1000)
        : null;

      // Start this segment – assign real trackNumber, workDay, segmentOrder
      let segments = s.route.segments.map((seg) =>
        seg.id === segmentId
          ? {
              ...seg,
              status: 'en_progreso' as const,
              trackNumber: nextTrack,
              plannedTrackNumber: null,
              plannedBy: undefined,
              timestampInicio: now,
              startedAt: now,
              workDay: s.workDay,
              segmentOrder,
              segmentStartSeconds: garminStart,
            }
          : seg
      );

      // RST: pre-assign plannedTrackNumber to next visible pending (non-nonRecordable) siblings
      if (s.rstMode && s.rstGroupSize > 1 && currentIdx >= 0) {
        let assigned = 0;
        const maxToAssign = s.rstGroupSize - 1 - (trackSession.segmentIds.length - 1);
        for (let i = currentIdx + 1; i < s.route.optimizedOrder.length && assigned < maxToAssign; i++) {
          const sibId = s.route.optimizedOrder[i];
          const sib = segments.find((seg) => seg.id === sibId);
          if (!sib || sib.status !== 'pendiente') continue;
          if (sib.nonRecordable) continue;
          if (hiddenLayers && sib.layer && hiddenLayers.has(sib.layer)) continue;
          if (sib.trackNumber === null && (sib.plannedTrackNumber === null || sib.plannedTrackNumber === undefined)) {
            segments = segments.map((seg) =>
              seg.id === sibId ? { ...seg, plannedTrackNumber: nextTrack, plannedBy: 'rst' as const } : seg
            );
            assigned++;
          }
        }
      }

      return { ...s, route: { ...s.route, segments }, activeSegmentId: segmentId, trackSession };
    }, true);
    // Emit TRACK_OPENED when a new track session was just created
    // We read the state after mutation to check if a new session started
    setStateRaw((current) => {
      if (current.trackSession && current.trackSession.segmentIds.length === 1 && current.trackSession.segmentIds[0] === segmentId) {
        logEvent('TRACK_OPENED', {
          workDay: current.workDay,
          trackNumber: current.trackSession.trackNumber,
          payload: { capacity: current.trackSession.capacity },
        });
      }
      return current; // no mutation, just reading
    });
    logEvent('SEGMENT_STARTED', { segmentId, payload: { segmentName: '' } });
  }, [setState]);

  const completeSegment = useCallback((segmentId: string, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      // Guard: block if end-of-video prompt is open
      if (s.blockEndPrompt.isOpen) return s;

      const now = new Date().toISOString();
      const groupLimit = s.rstMode && s.rstGroupSize > 0 ? s.rstGroupSize : 1;

      // Auto-assign track if missing (invariant: completed must have trackNumber)
      let autoTrack: number | null = null;
      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      if (seg && seg.trackNumber === null) {
        autoTrack = allocateTrackNumber(s.route.segments, s.rstMode, groupLimit, s.trackSession && s.trackSession.active ? s.trackSession : null, s.workDay);
      }

      // Garmin mode: compute segmentEndSeconds relative to track start
      const garminEnd = s.acquisitionMode === 'GARMIN' && s.trackSession?.trackStartTime
        ? Math.round((Date.now() - s.trackSession.trackStartTime) / 1000)
        : null;

      // Only complete THIS segment with invariants enforced
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        // Safety: nonRecordable cannot be Completado
        if (seg.nonRecordable) {
          return { ...seg, status: 'posible_repetir' as const, trackNumber: null, endedAt: null };
        }
        const finalTrack = autoTrack !== null ? autoTrack : seg.trackNumber;
        return {
          ...seg,
          status: 'completado' as const,
          trackNumber: finalTrack,
          timestampFin: now,
          timestampInicio: seg.timestampInicio || now,
          endedAt: now,
          startedAt: seg.startedAt || now,
          // Clear repeat flags on successful completion
          needsRepeat: false,
          repeatRequested: false,
          invalidatedByTrack: null,
          repeatNumber: (seg.repeatNumber || 0) + 1,
          segmentEndSeconds: garminEnd ?? seg.segmentEndSeconds ?? null,
        };
      });

      // Close track session if full
      let trackSession = s.trackSession;
      let blockEndPrompt = s.blockEndPrompt;
      if (!s.rstMode && trackSession && trackSession.active) {
        // RST OFF: close after each segment (1:1)
        trackSession = { ...trackSession, active: false, endedAt: now };
      } else if (s.rstMode && trackSession && trackSession.active) {
        // RST ON: count valid completed segments in this track
        const validInTrack = segments.filter(
          (seg) =>
            seg.workDay === s.workDay &&
            seg.trackNumber === trackSession!.trackNumber &&
            seg.status === 'completado' &&
            !seg.nonRecordable &&
            !seg.needsRepeat
        ).length;
        if (validInTrack >= trackSession.capacity) {
          // Auto-close: capacity reached → trigger blocking prompt
          trackSession = { ...trackSession, active: false, endedAt: now };
          blockEndPrompt = { isOpen: true, trackNumber: trackSession.trackNumber, reason: 'capacity' };
        }
      }

      // Next pending according to optimizedOrder, respecting hidden layers and nonRecordable
      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        if (!seg || seg.status !== 'pendiente') return false;
        if (seg.nonRecordable) return false;
        if (hiddenLayers && seg.layer && hiddenLayers.has(seg.layer)) return false;
        return true;
      });

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: remaining[0] || null,
        trackSession,
        blockEndPrompt,
      };
    }, true);
    logEvent('SEGMENT_COMPLETED', { segmentId });
  }, [setState]);

  /** Finalize the current track session (close early) */
  const finalizeTrack = useCallback(() => {
    setState((s) => {
      if (!s.trackSession || !s.trackSession.active) return s;
      const now = new Date().toISOString();
      const trackNum = s.trackSession.trackNumber;

      // Clear planned track numbers for the current track
      let segments = s.route?.segments || [];
      segments = segments.map((seg) => {
        if (seg.plannedTrackNumber === trackNum && seg.status === 'pendiente') {
          return { ...seg, plannedTrackNumber: null, plannedBy: undefined };
        }
        return seg;
      });

      return {
        ...s,
        route: s.route ? { ...s.route, segments } : null,
        trackSession: {
          ...s.trackSession,
          active: false,
          endedAt: now,
          closedManually: true,
        },
        blockEndPrompt: { isOpen: true, trackNumber: trackNum, reason: 'manual' },
      };
    }, true);
    logEvent('TRACK_CLOSED', { payload: { reason: 'manual' } });
  }, [setState]);

  /** Mark segment as posible_repetir (called when adding an incident) */
  const markPosibleRepetir = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
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

      // Remove from track session if present
      let trackSession = s.trackSession;
      if (trackSession && trackSession.segmentIds.includes(segmentId)) {
        trackSession = {
          ...trackSession,
          segmentIds: trackSession.segmentIds.filter((id) => id !== segmentId),
        };
      }

      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente' && !seg.nonRecordable;
      });

      return {
        ...s,
        route: { ...s.route, segments },
        activeSegmentId: remaining[0] || null,
        trackSession,
      };
    }, true);
  }, [setState]);

  /** Explicit repeat: reset posible_repetir segment to pendiente */
  const repeatSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      if (s.blockEndPrompt.isOpen) return s;
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
          startedAt: null,
          endedAt: null,
          failedAt: null,
          nonRecordable: false,
          needsRepeat: false,
          repeatRequested: false,
          invalidatedByTrack: null,
        };
      });
      return { ...s, route: { ...s.route, segments } };
    }, true);
    logEvent('SEGMENT_REPEATED', { segmentId });
  }, [setState]);

  const addIncident = useCallback((segmentId: string, category: IncidentCategory, impact: IncidentImpact, note?: string, location?: LatLng, currentSegmentNonRecordable?: boolean) => {
    setState((s) => {
      if (!s.route) return { ...s };

      const seg = s.route.segments.find((seg) => seg.id === segmentId);
      const now = new Date().toISOString();

      const newIncident: Incident = {
        id: Math.random().toString(36).substring(2, 10),
        segmentId,
        category,
        impact,
        note,
        timestamp: now,
        location,
        trackAtIncident: seg?.trackNumber ?? null,
        invalidatedBlock: impact === 'critica_invalida_bloque',
      };

      let segments = [...s.route.segments];
      let trackSession = s.trackSession;

      if (impact === 'informativa') {
        // No changes to track/status
      } else if (impact === 'critica_no_grabable') {
        // Mark segment as physically non-recordable
        segments = segments.map((seg) => {
          if (seg.id !== segmentId) return seg;
          const newHistory = seg.trackNumber !== null
            ? [...seg.trackHistory, seg.trackNumber]
            : seg.trackHistory;
          return {
            ...seg,
            status: 'posible_repetir' as const,
            nonRecordable: true,
            needsRepeat: false,
            trackNumber: null,
            trackHistory: newHistory,
            failedAt: now,
            endedAt: null,
            plannedTrackNumber: null,
            plannedBy: undefined,
          };
        });

        // Remove from track session
        if (trackSession && trackSession.segmentIds.includes(segmentId)) {
          trackSession = {
            ...trackSession,
            segmentIds: trackSession.segmentIds.filter((id) => id !== segmentId),
          };
        }
      } else if (impact === 'critica_invalida_bloque') {
        // 2.1 Previous segments in the track → needsRepeat, back to itinerary
        const previousIds = new Set(
          (trackSession?.segmentIds || []).filter((id) => id !== segmentId)
        );
        const invalidatedTrackNum = trackSession?.trackNumber ?? null;

        segments = segments.map((seg) => {
          // 2.1 Previous segments in the same track
          if (previousIds.has(seg.id)) {
            const newHistory = seg.trackNumber !== null
              ? [...seg.trackHistory, seg.trackNumber]
              : seg.trackHistory;
            return {
              ...seg,
              status: 'pendiente' as const,
              needsRepeat: true,
              nonRecordable: false,
              repeatRequested: false,
              invalidatedByTrack: invalidatedTrackNum,
              trackNumber: null,
              trackHistory: newHistory,
              startedAt: null,
              endedAt: null,
              failedAt: now,
              plannedTrackNumber: null,
              plannedBy: undefined,
            };
          }

          // 2.2 Current segment where the incident occurred
          if (seg.id === segmentId) {
            const newHistory = seg.trackNumber !== null
              ? [...seg.trackHistory, seg.trackNumber]
              : seg.trackHistory;

            if (currentSegmentNonRecordable) {
              // INVALIDATE_BLOCK + NON_RECORDABLE: current segment is non-recordable, excluded from itinerary
              return {
                ...seg,
                status: 'posible_repetir' as const,
                nonRecordable: true,
                needsRepeat: false,
                invalidatedByTrack: invalidatedTrackNum,
                trackNumber: null,
                trackHistory: newHistory,
                startedAt: null,
                endedAt: null,
                failedAt: now,
                plannedTrackNumber: null,
                plannedBy: undefined,
              };
            } else {
              // INVALIDATE_BLOCK only: current segment is recordable, goes back for repeat
              return {
                ...seg,
                status: 'pendiente' as const,
                needsRepeat: true,
                nonRecordable: false,
                repeatRequested: false,
                invalidatedByTrack: invalidatedTrackNum,
                trackNumber: null,
                trackHistory: newHistory,
                startedAt: null,
                endedAt: null,
                failedAt: now,
                plannedTrackNumber: null,
                plannedBy: undefined,
              };
            }
          }

          return seg;
        });

        // Close the track session and force next track increment
        if (trackSession) {
          trackSession = {
            ...trackSession,
            active: false,
            endedAt: now,
            segmentIds: [],
          };
        }
      }

      // Find next valid segment
      const remaining = s.route.optimizedOrder.filter((id) => {
        const seg = segments.find((seg) => seg.id === id);
        return seg?.status === 'pendiente' && !seg.nonRecordable;
      });

      return {
        ...s,
        route: { ...s.route, segments },
        incidents: [...s.incidents, newIncident],
        activeSegmentId: impact !== 'informativa' ? (remaining[0] || null) : s.activeSegmentId,
        trackSession,
      };
    }, true);
    logEvent('INCIDENT_RECORDED', { segmentId, payload: { category, impact, note: note || '' } });
  }, [setState]);

  const reoptimize = useCallback((currentPos?: LatLng | null, hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      const basePos = currentPos || s.base?.position || null;
      const hidden = hiddenLayers || new Set<string>();

      // Only optimize visible, valid segments
      const isVisible = (seg: Segment) => !seg.layer || !hidden.has(seg.layer);
      const isPending = (seg: Segment) =>
        (seg.status === 'pendiente' || (seg.status === 'posible_repetir' && seg.needsRepeat));

      const visiblePending = s.route.segments.filter((seg) => isVisible(seg) && isPending(seg) && !seg.nonRecordable);
      const visibleNonRecordable = s.route.segments.filter((seg) => isVisible(seg) && isPending(seg) && seg.nonRecordable);
      const rest = s.route.segments.filter((seg) => !isVisible(seg) || !isPending(seg));

      if (visiblePending.length === 0 && visibleNonRecordable.length === 0) {
        return s; // Nothing visible to optimize
      }

      const newOrder = [
        ...rest.map((seg) => seg.id),
        ...optimizeRoute(visiblePending, basePos),
        ...visibleNonRecordable.map((seg) => seg.id),
      ];
      return { ...s, route: { ...s.route, optimizedOrder: newOrder } };
    });
  }, [setState]);

  /** Apply a specific candidate route order as the active operative route */
  const applyRouteOrder = useCallback((segmentIds: string[], hiddenLayers?: Set<string>) => {
    setState((s) => {
      if (!s.route) return s;
      const hidden = hiddenLayers || new Set<string>();
      const isVisible = (seg: Segment) => !seg.layer || !hidden.has(seg.layer);
      const isPending = (seg: Segment) =>
        (seg.status === 'pendiente' || (seg.status === 'posible_repetir' && seg.needsRepeat));

      // Keep non-pending and hidden segments in their original position
      const rest = s.route.segments.filter((seg) => !isVisible(seg) || !isPending(seg));
      const visibleNonRecordable = s.route.segments.filter(
        (seg) => isVisible(seg) && isPending(seg) && seg.nonRecordable,
      );

      const newOrder = [
        ...rest.map((seg) => seg.id),
        ...segmentIds,
        ...visibleNonRecordable.map((seg) => seg.id),
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
          startedAt: null,
          endedAt: null,
          failedAt: null,
          nonRecordable: false,
          needsRepeat: false,
          repeatRequested: false,
          invalidatedByTrack: null,
        };
      });
      return { ...s, route: { ...s.route, segments } };
    }, true);
    logEvent('SEGMENT_RESET', { segmentId });
  }, [setState]);

  /** Close the block-end prompt, allowing actions to resume */
  const closeBlockEndPrompt = useCallback(() => {
    setState((s) => ({
      ...s,
      blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' },
    }));
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
      trackSession: null,
      blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' },
      workDay: s.workDay,
      acquisitionMode: s.acquisitionMode,
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
      // Swap in optimizedOrder (source of truth for route numbering)
      const order = [...s.route.optimizedOrder];
      const idx = order.indexOf(segmentId);
      if (idx < 0) return s;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= order.length) return s;
      [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
      // Also swap in segments array to keep visual order consistent
      const segs = [...s.route.segments];
      const segIdx = segs.findIndex((seg) => seg.id === segmentId);
      if (segIdx >= 0) {
        const segNewIdx = direction === 'up' ? segIdx - 1 : segIdx + 1;
        if (segNewIdx >= 0 && segNewIdx < segs.length) {
          [segs[segIdx], segs[segNewIdx]] = [segs[segNewIdx], segs[segIdx]];
        }
      }
      return { ...s, route: { ...s.route, segments: segs, optimizedOrder: order } };
    });
  }, [setState]);

  /** Reverse a segment's coordinates (flip start/end). Allowed for any segment — field correction takes priority. */
  const reverseSegment = useCallback((segmentId: string) => {
    setState((s) => {
      if (!s.route) return s;
      const segments = s.route.segments.map((seg) => {
        if (seg.id !== segmentId) return seg;
        return {
          ...seg,
          coordinates: [...seg.coordinates].reverse(),
        };
      });
      return { ...s, route: { ...s.route, segments } };
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
    setState((s) => {
      // When switching RST off, reset track session so next segment gets a fresh unique track
      if (!enabled && s.trackSession && s.trackSession.active) {
        const now = new Date().toISOString();
        // Also clear planned track numbers from RST planning
        let segments = s.route?.segments || [];
        const trackNum = s.trackSession.trackNumber;
        segments = segments.map((seg) => {
          if (seg.plannedTrackNumber === trackNum && seg.status === 'pendiente') {
            return { ...seg, plannedTrackNumber: null, plannedBy: undefined };
          }
          return seg;
        });
        return {
          ...s,
          rstMode: enabled,
          route: s.route ? { ...s.route, segments } : null,
          trackSession: { ...s.trackSession, active: false, endedAt: now, closedManually: true },
        };
      }
      return { ...s, rstMode: enabled };
    });
  }, [setState]);

  const setRstGroupSize = useCallback((size: number) => {
    setState((s) => ({ ...s, rstGroupSize: size }));
  }, [setState]);

  /** Set the current work day. Resets track numbering for the new day. */
  const setWorkDay = useCallback((day: number) => {
    setState((s) => {
      // Close any active track session when changing day
      let trackSession = s.trackSession;
      if (trackSession && trackSession.active) {
        trackSession = { ...trackSession, active: false, endedAt: new Date().toISOString(), closedManually: true };
      }
      return {
        ...s,
        workDay: day,
        trackSession: null,
        blockEndPrompt: { isOpen: false, trackNumber: null, reason: 'capacity' as const },
      };
    }, true);
    logEvent('WORK_DAY_CHANGED', { workDay: day });
  }, [setState]);

  /** Update route context fields (operator, vehicle, weather) */
  const updateRouteContext = useCallback((updates: { operator?: string; vehicle?: string; weather?: string }) => {
    setState((s) => {
      if (!s.route) return s;
      return { ...s, route: { ...s.route, ...updates } };
    });
  }, [setState]);

  /** Apply companySegmentId retroactively to segments missing it */
  const applyRetroactiveIds = useCallback((code: string, projectName: string) => {
    setState((s) => {
      if (!s.route) return s;
      // Find max existing index
      let maxIndex = -1;
      for (const seg of s.route.segments) {
        if (seg.companySegmentId) {
          const parts = seg.companySegmentId.split('_');
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxIndex) maxIndex = num;
        }
      }
      let nextIndex = maxIndex + 1;
      const segments = s.route.segments.map((seg) => {
        if (seg.companySegmentId) return seg;
        const id = `${code}_${String(nextIndex).padStart(5, '0')}`;
        nextIndex++;
        return { ...seg, companySegmentId: id };
      });
      return {
        ...s,
        route: { ...s.route, segments, projectCode: code, projectName: projectName || code },
      };
    }, true);
  }, [setState]);

  /** Set acquisition mode (RST or GARMIN) */
  const setAcquisitionMode = useCallback((mode: import('@/types/route').AcquisitionMode) => {
    setState((s) => ({ ...s, acquisitionMode: mode }));
  }, [setState]);

  /** Restore full state from async persistence (IndexedDB) */
  const restoreState = useCallback((restored: AppState) => {
    setStateRaw(restored);
  }, []);

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
    reverseSegment,
    simplifySegments,
    setRstMode,
    setRstGroupSize,
    markPosibleRepetir,
    repeatSegment,
    finalizeTrack,
    skipSegment,
    closeBlockEndPrompt,
    setWorkDay,
    updateRouteContext,
    applyRetroactiveIds,
    setAcquisitionMode,
    applyRouteOrder,
    restoreState,
  };
}

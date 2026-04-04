import { useState, useEffect, useCallback, useMemo } from 'react';
import { useConnectivity } from './useConnectivity';
import {
  getActiveOfflineMapId,
  listOfflineTileSources,
  findSourceForPoint,
  OFFLINE_MAP_CHANGED_EVENT,
  type OfflineTileSource,
} from '@/utils/offline-tiles';
import type { LatLng, Segment } from '@/types/route';

/**
 * Operational map state — single source of truth.
 *
 * - 'google-online': Google Maps with network
 * - 'leaflet-online': Leaflet with online tiles (no API key / auth error)
 * - 'leaflet-offline-real': Leaflet with a real PMTiles offline map loaded
 * - 'leaflet-offline-cache': Leaflet offline using only cached tiles (degraded)
 * - 'leaflet-no-coverage': Leaflet offline, no tiles available at all
 */
export type MapProviderState =
  | 'google-online'
  | 'leaflet-online'
  | 'leaflet-offline-real'
  | 'leaflet-offline-cache'
  | 'leaflet-no-coverage';

export interface MapStateInfo {
  /** Current operational state */
  provider: MapProviderState;
  /** Whether network is available */
  isOnline: boolean;
  /** Active offline map source (if any) */
  activeOfflineSource: OfflineTileSource | null;
  /** Whether the active offline map covers the campaign/active area */
  coverageValid: boolean;
  /** Human-readable label for the status badge */
  label: string;
  /** Badge color class */
  badgeClass: string;
  /** All available offline sources */
  offlineSources: OfflineTileSource[];
}

interface UseMapStateOptions {
  /** Is Google Maps the configured provider (API key exists)? */
  googleAvailable: boolean;
  /** Did Google Maps fail (auth error, etc.)? */
  googleFailed: boolean;
  /** Is the offline switch active (Leaflet shown due to connectivity loss)? */
  offlineSwitch: boolean;
  /** Is a real offline PMTiles layer currently rendered on the map? */
  offlineLayerActive: boolean;
  /** Active segment coordinates for coverage check */
  activeSegment?: Segment | null;
  /** All campaign segments for bounding box coverage */
  segments?: Segment[];
  /** Current GPS position */
  currentPosition?: LatLng | null;
}

/**
 * Compute the bounding box centroid of all campaign segments.
 * More robust than map center for coverage matching.
 */
function campaignCentroid(segments: Segment[]): LatLng | null {
  if (segments.length === 0) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const seg of segments) {
    for (const c of seg.coordinates) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
    }
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

/**
 * Check if a source covers the campaign area using multiple reference points.
 * Returns a coverage score 0-1 (fraction of reference points covered).
 */
export function computeCoverageScore(
  source: OfflineTileSource,
  segments: Segment[],
  activeSegment?: Segment | null,
  position?: LatLng | null,
): number {
  const points: LatLng[] = [];

  // Priority 1: active segment start/end
  if (activeSegment && activeSegment.coordinates.length > 0) {
    points.push(activeSegment.coordinates[0]);
    points.push(activeSegment.coordinates[activeSegment.coordinates.length - 1]);
  }

  // Priority 2: GPS position
  if (position) points.push(position);

  // Priority 3: campaign bounding box corners + centroid
  if (segments.length > 0) {
    const centroid = campaignCentroid(segments);
    if (centroid) points.push(centroid);

    // Sample a few segment start/end points
    const step = Math.max(1, Math.floor(segments.length / 6));
    for (let i = 0; i < segments.length; i += step) {
      const seg = segments[i];
      if (seg.coordinates.length > 0) {
        points.push(seg.coordinates[0]);
        points.push(seg.coordinates[seg.coordinates.length - 1]);
      }
    }
  }

  if (points.length === 0) return 0;

  let covered = 0;
  for (const p of points) {
    if (findSourceForPoint([source], p.lat, p.lng)) covered++;
  }
  return covered / points.length;
}

/**
 * Select the best offline map source for the current campaign context.
 */
export function selectBestSource(
  sources: OfflineTileSource[],
  segments: Segment[],
  activeSegment?: Segment | null,
  position?: LatLng | null,
): { source: OfflineTileSource; score: number } | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) {
    const score = computeCoverageScore(sources[0], segments, activeSegment, position);
    return { source: sources[0], score };
  }

  let best: { source: OfflineTileSource; score: number } | null = null;
  for (const s of sources) {
    const score = computeCoverageScore(s, segments, activeSegment, position);
    if (!best || score > best.score) {
      best = { source: s, score };
    }
  }
  return best;
}

export function useMapState(options: UseMapStateOptions): MapStateInfo {
  const { isOnline } = useConnectivity();
  const [offlineSources, setOfflineSources] = useState<OfflineTileSource[]>([]);

  // Load sources on mount and on changes
  useEffect(() => {
    listOfflineTileSources().then(setOfflineSources).catch(() => {});
    const handler = () => {
      listOfflineTileSources().then(setOfflineSources).catch(() => {});
    };
    window.addEventListener(OFFLINE_MAP_CHANGED_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_MAP_CHANGED_EVENT, handler);
  }, []);

  // Find active source
  const activeOfflineSource = useMemo(() => {
    const activeId = getActiveOfflineMapId();
    if (!activeId) return null;
    return offlineSources.find((s) => s.id === activeId) ?? null;
  }, [offlineSources, options.offlineLayerActive]);

  // Compute coverage validity
  const coverageValid = useMemo(() => {
    if (!activeOfflineSource) return false;
    const score = computeCoverageScore(
      activeOfflineSource,
      options.segments ?? [],
      options.activeSegment,
      options.currentPosition,
    );
    return score >= 0.5;
  }, [activeOfflineSource, options.segments, options.activeSegment, options.currentPosition]);

  // Derive provider state
  const provider = useMemo<MapProviderState>(() => {
    const usingLeaflet = options.googleFailed || !options.googleAvailable || options.offlineSwitch;

    if (!usingLeaflet && isOnline) return 'google-online';
    if (usingLeaflet && isOnline && !options.offlineLayerActive) return 'leaflet-online';
    if (options.offlineLayerActive) return 'leaflet-offline-real';
    if (!isOnline && offlineSources.length > 0) return 'leaflet-offline-cache';
    if (!isOnline) return 'leaflet-no-coverage';
    return 'leaflet-online';
  }, [isOnline, options.googleAvailable, options.googleFailed, options.offlineSwitch, options.offlineLayerActive, offlineSources]);

  // Derive label & badge
  const { label, badgeClass } = useMemo(() => {
    switch (provider) {
      case 'google-online':
        return {
          label: '● Google Maps',
          badgeClass: 'bg-green-500/20 text-green-400 border border-green-500/30',
        };
      case 'leaflet-online':
        return {
          label: '● Mapa online',
          badgeClass: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
        };
      case 'leaflet-offline-real':
        return {
          label: coverageValid
            ? `● Offline: ${activeOfflineSource?.name ?? 'mapa local'}`
            : `⚠ Offline: cobertura parcial`,
          badgeClass: coverageValid
            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
            : 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
        };
      case 'leaflet-offline-cache':
        return {
          label: '● Sin red (caché temporal)',
          badgeClass: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
        };
      case 'leaflet-no-coverage':
        return {
          label: '⚠ Sin red ni mapa offline',
          badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/30',
        };
    }
  }, [provider, coverageValid, activeOfflineSource]);

  return {
    provider,
    isOnline,
    activeOfflineSource,
    coverageValid,
    label,
    badgeClass,
    offlineSources,
  };
}

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoogleMapDisplay } from '@/components/GoogleMapDisplay';
import { MapControlPanel } from '@/components/MapControlPanel';
import { useGeolocation } from '@/hooks/useGeolocation';
import { distanceToSegment } from '@/utils/route-optimizer';
import { playDeviationSound } from '@/utils/sounds';
import type { AppState, IncidentCategory, LatLng, BaseLocation } from '@/types/route';

const DEVIATION_THRESHOLD = 100;

interface Props {
  state: AppState;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onConfirmStart: (segmentId: string) => void;
  onComplete: (segmentId: string) => void;
  onResetSegment: (segmentId: string) => void;
  onAddIncident: (segmentId: string, category: IncidentCategory, note?: string, location?: LatLng) => void;
  onReoptimize: (pos?: LatLng | null) => void;
  onSetActiveSegment: (segmentId: string) => void;
  onSetBase: (base: BaseLocation) => void;
}

export default function MapPage({
  state,
  onStartNavigation,
  onStopNavigation,
  onConfirmStart,
  onComplete,
  onResetSegment,
  onAddIncident,
  onReoptimize,
  onSetActiveSegment,
  onSetBase,
}: Props) {
  const navigate = useNavigate();
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [basePosition, setBasePosition] = useState<LatLng | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const geo = useGeolocation(gpsEnabled);
  const lastDeviationRef = useRef(0);

  // Save first GPS position as base
  useEffect(() => {
    if (geo.position && !basePosition) {
      setBasePosition(geo.position);
    }
  }, [geo.position, basePosition]);

  // Deviation detection during active recording
  const activeSegment = state.route?.segments.find((s) => s.id === state.activeSegmentId);
  useEffect(() => {
    if (!geo.position || !activeSegment || activeSegment.status !== 'en_progreso') return;
    const dist = distanceToSegment(geo.position, activeSegment);
    if (dist > DEVIATION_THRESHOLD && Date.now() - lastDeviationRef.current > 10000) {
      playDeviationSound();
      lastDeviationRef.current = Date.now();
    }
  }, [geo.position, activeSegment]);

  const handleReoptimize = useCallback(() => {
    // Turn on GPS if not already on
    if (!gpsEnabled) setGpsEnabled(true);
    onReoptimize(geo.position);
  }, [gpsEnabled, geo.position, onReoptimize]);

  const handleStartNavigation = useCallback(() => {
    if (!gpsEnabled) setGpsEnabled(true);
    onStartNavigation();
  }, [gpsEnabled, onStartNavigation]);

  const handleExportToGoogleMaps = useCallback(() => {
    if (!state.route) return;
    const route = state.route;
    // Get first 6 pending/in-progress segments
    const itinerary = route.optimizedOrder
      .filter((id) => {
        const seg = route.segments.find((s) => s.id === id);
        return seg?.status === 'pendiente' || seg?.status === 'en_progreso';
      })
      .slice(0, 6);

    if (itinerary.length === 0) return;

    // 2 waypoints per segment: start + end
    const waypoints: string[] = [];
    for (const id of itinerary) {
      const seg = route.segments.find((s) => s.id === id)!;
      const start = seg.coordinates[0];
      const end = seg.coordinates[seg.coordinates.length - 1];
      waypoints.push(`${start.lat},${start.lng}`);
      waypoints.push(`${end.lat},${end.lng}`);
    }

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const middle = waypoints.slice(1, -1).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
    if (middle) url += `&waypoints=${middle}`;

    window.open(url, '_blank');
  }, [state.route]);

  const route = state.route;

  const visibleSegments = useMemo(() => {
    if (!route || selectedSegmentIds.size === 0) return route?.segments ?? [];
    return route.segments.filter((s) => selectedSegmentIds.has(s.id));
  }, [route, selectedSegmentIds]);

  const visibleOrder = useMemo(() => {
    if (!route || selectedSegmentIds.size === 0) return route?.optimizedOrder ?? [];
    return route.optimizedOrder.filter((id) => selectedSegmentIds.has(id));
  }, [route, selectedSegmentIds]);

  if (!route) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="text-muted-foreground mb-4">No hay ruta cargada</p>
        <Button onClick={() => navigate('/')} className="driving-button bg-primary text-primary-foreground">
          <Upload className="w-5 h-5 mr-2" />
          Cargar archivo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1">
        <GoogleMapDisplay
          segments={visibleSegments}
          activeSegmentId={state.activeSegmentId}
          currentPosition={geo.position}
          optimizedOrder={visibleOrder}
          onSegmentClick={onSetActiveSegment}
        />
      </div>

      {/* Control panel overlay */}
      <MapControlPanel
        segments={route.segments}
        optimizedOrder={route.optimizedOrder}
        activeSegmentId={state.activeSegmentId}
        gpsEnabled={gpsEnabled}
        currentPosition={geo.position}
        gpsAccuracy={geo.accuracy}
        gpsSpeed={geo.speed}
        gpsError={geo.error}
        navigationActive={state.navigationActive}
        base={state.base}
        onToggleGps={setGpsEnabled}
        onConfirmStart={onConfirmStart}
        onComplete={onComplete}
        onResetSegment={onResetSegment}
        onAddIncident={onAddIncident}
        onReoptimize={handleReoptimize}
        onStartNavigation={handleStartNavigation}
        onStopNavigation={onStopNavigation}
        onExportToGoogleMaps={handleExportToGoogleMaps}
        onSegmentSelect={onSetActiveSegment}
        onSetBase={onSetBase}
        selectedSegmentIds={selectedSegmentIds}
        onSelectedSegmentsChange={setSelectedSegmentIds}
      />
    </div>
  );
}

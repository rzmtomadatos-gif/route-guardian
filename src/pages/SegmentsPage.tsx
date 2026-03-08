import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentEditDialog } from '@/components/SegmentEditDialog';
import { LayerPanel } from '@/components/LayerPanel';
import { SelectionToolbar } from '@/components/SelectionToolbar';
import { CampaignSummary } from '@/components/CampaignSummary';
import { useGeolocation } from '@/hooks/useGeolocation';
import { Download, Search, MapPin, ArrowUpDown, AlertTriangle, Navigation, Crosshair, Star } from 'lucide-react';
import { exportRouteToExcel, validateForExport, type ExportValidationError } from '@/utils/excel-export';
import { segmentDistanceKm } from '@/utils/geo-distance';
import { buildDisplayOrderMap } from '@/utils/display-order';
import type { AppState, Incident, LatLng, Segment, SegmentStatus } from '@/types/route';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const STATUS_OPTIONS: { value: SegmentStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completado', label: 'Completados' },
  { value: 'posible_repetir', label: 'Posible repetir' },
];

/** Haversine distance in meters between two LatLng points */
function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

interface Props {
  state: AppState;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onResetSegment: (segmentId: string) => void;
  onCompleteSegment: (segmentId: string) => void;
  onUpdateSegment: (segmentId: string, updates: Partial<Segment>) => void;
  onUpdateIncident: (incidentId: string, updates: Partial<Incident>) => void;
  onDeleteIncident: (incidentId: string) => void;
  onSetActiveSegment: (segmentId: string) => void;
  onRenameLayer: (oldName: string, newName: string) => void;
  onDeleteLayer: (name: string) => void;
  onMoveToLayer: (segId: string, layer: string | undefined) => void;
  onMergeSegments: (ids: string[]) => void;
  onAddLayer: (name: string) => void;
  onDeleteSegment: (segId: string) => void;
  onBulkDelete: (ids: string[]) => void;
  onBulkMove: (ids: string[], layer: string | undefined) => void;
  onBulkColor: (ids: string[], color: string) => void;
  onDuplicate: (ids: string[]) => void;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  onSimplify: () => void;
  hiddenLayers: Set<string>;
  onHiddenLayersChange: (layers: Set<string>) => void;
}

export default function SegmentsPage({
  state,
  selectedIds,
  onSelectedIdsChange,
  onResetSegment,
  onCompleteSegment,
  onUpdateSegment,
  onUpdateIncident,
  onDeleteIncident,
  onSetActiveSegment,
  onRenameLayer,
  onDeleteLayer,
  onMoveToLayer,
  onMergeSegments,
  onAddLayer,
  onDeleteSegment,
  onBulkDelete,
  onBulkMove,
  onBulkColor,
  onDuplicate,
  onReorder,
  onSimplify,
  hiddenLayers,
  onHiddenLayersChange,
}: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SegmentStatus | 'todos'>(() => {
    try {
      const saved = localStorage.getItem('vialroute_segments_filter');
      if (saved === 'todos' || saved === 'pendiente' || saved === 'en_progreso' || saved === 'completado') return saved;
    } catch {}
    return 'pendiente';
  });
  const [editingSeg, setEditingSeg] = useState<Segment | null>(null);
  const [sortByDistance, setSortByDistance] = useState(false);
  const [sortByProximity, setSortByProximity] = useState(false);
  const [exportErrors, setExportErrors] = useState<ExportValidationError[]>([]);
  const [showExportAlert, setShowExportAlert] = useState(false);

  // Geolocation for proximity features
  const geo = useGeolocation(true);

  const route = state.route;
  const incidents = state.incidents;

  // Cache segment lengths
  const distanceMap = useMemo(() => {
    if (!route) return new Map<string, number>();
    const m = new Map<string, number>();
    route.segments.forEach((s) => m.set(s.id, segmentDistanceKm(s.coordinates)));
    return m;
  }, [route]);

  // Distance from vehicle to segment start (meters)
  const vehicleDistanceMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!route || !geo.position) return m;
    route.segments.forEach((s) => {
      if (s.coordinates.length > 0) {
        m.set(s.id, haversineMeters(geo.position!, s.coordinates[0]));
      }
    });
    return m;
  }, [route, geo.position]);

  // Filter segments
  const filtered = useMemo(() => {
    if (!route) return [];
    let segs = [...route.segments];
    if (statusFilter !== 'todos') {
      segs = segs.filter((s) => s.status === statusFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      segs = segs.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.kmlId.toLowerCase().includes(q) ||
          String(s.trackNumber).includes(q) ||
          (s.layer || '').toLowerCase().includes(q)
      );
    }
    if (sortByProximity && geo.position) {
      segs.sort((a, b) => (vehicleDistanceMap.get(a.id) || Infinity) - (vehicleDistanceMap.get(b.id) || Infinity));
    } else if (sortByDistance) {
      segs.sort((a, b) => (distanceMap.get(b.id) || 0) - (distanceMap.get(a.id) || 0));
    }
    return segs;
  }, [route, statusFilter, search, sortByDistance, sortByProximity, distanceMap, vehicleDistanceMap, geo.position]);

  // Total distance of filtered segments
  const totalDistanceKm = useMemo(() => {
    return filtered.reduce((sum, s) => sum + (distanceMap.get(s.id) || 0), 0);
  }, [filtered, distanceMap]);

  // Distance of selected segments
  const selectedDistanceKm = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    let total = 0;
    selectedIds.forEach((id) => { total += distanceMap.get(id) || 0; });
    return total;
  }, [selectedIds, distanceMap]);

  // All layer names
  const allLayerNames = useMemo(() => {
    if (!route) return [];
    const fromSegments = route.segments.map((s) => s.layer).filter(Boolean) as string[];
    const fromMeta = route.availableLayers || [];
    return [...new Set([...fromSegments, ...fromMeta])].sort();
  }, [route]);

  // Recommended next segment: nearest visible pending segment
  const recommendedSegmentId = useMemo(() => {
    if (!route || !geo.position) return null;
    let best: { id: string; dist: number } | null = null;
    route.segments.forEach((s) => {
      if (s.status !== 'pendiente') return;
      if (s.layer && hiddenLayers.has(s.layer)) return;
      const dist = vehicleDistanceMap.get(s.id);
      if (dist !== undefined && (!best || dist < best.dist)) {
        best = { id: s.id, dist };
      }
    });
    return best?.id ?? null;
  }, [route, geo.position, vehicleDistanceMap, hiddenLayers]);

  // Single source of truth: segment display order from optimized route
  const displayOrderMap = useMemo(() => {
    if (!route) return new Map<string, number>();
    return buildDisplayOrderMap(route.optimizedOrder);
  }, [route]);

  // Stats
  const pending = route?.segments.filter((s) => s.status === 'pendiente').length ?? 0;
  const inProgress = route?.segments.filter((s) => s.status === 'en_progreso').length ?? 0;
  const completed = route?.segments.filter((s) => s.status === 'completado').length ?? 0;
  const possibleRepeat = route?.segments.filter((s) => s.status === 'posible_repetir').length ?? 0;

  if (!route) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <div className="text-center space-y-3">
          <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">No hay ruta cargada</p>
          <Button onClick={() => navigate('/')} className="bg-primary text-primary-foreground">
            Cargar archivo
          </Button>
          <p className="text-[10px] text-muted-foreground">
            o ve al mapa para crear tramos desde cero
          </p>
        </div>
      </div>
    );
  }

  const handleExport = () => {
    const errors = validateForExport(
      selectedIds && selectedIds.size > 0
        ? route.segments.filter((s) => selectedIds.has(s.id))
        : route.segments,
      state.rstMode,
    );
    if (errors.length > 0) {
      setExportErrors(errors);
      setShowExportAlert(true);
    } else {
      exportRouteToExcel(route, incidents, selectedIds);
    }
  };

  const handleExportForceAutofix = () => {
    setShowExportAlert(false);
    exportRouteToExcel(route, incidents, selectedIds);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  };

  const selectMultiple = (ids: string[]) => {
    const next = new Set(selectedIds);
    ids.forEach((id) => next.add(id));
    onSelectedIdsChange(next);
  };

  const handleViewSelectedOnMap = () => {
    selectedIds.forEach((id) => onSetActiveSegment(id));
    navigate('/map?selected=' + Array.from(selectedIds).join(','));
  };

  const handleGoToNearest = () => {
    if (recommendedSegmentId) {
      onSetActiveSegment(recommendedSegmentId);
      navigate('/map');
    }
  };

  const handleCenterMapOnVisible = () => {
    navigate('/map?fitVisible=true');
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top toolbar */}
      <div className="flex-shrink-0 px-3 py-2 bg-card border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-foreground">{route.name}</h2>
          <div className="flex items-center gap-1">
            {selectedIds.size > 0 && (
              <Button size="sm" onClick={handleViewSelectedOnMap} className="h-7 text-[10px] gap-1">
                <MapPin className="w-3 h-3" />
                Ver {selectedIds.size} en mapa
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleExport} className="h-7 text-[10px] gap-1">
              <Download className="w-3 h-3" />
              Excel
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3 mb-2">
          <div className="flex gap-1 flex-1">
            <div className="h-1.5 rounded-full bg-muted flex-1 overflow-hidden">
              <div className="flex h-full">
                <div
                  className="bg-success transition-all"
                  style={{ width: `${(completed / route.segments.length) * 100}%` }}
                />
                <div
                  className="bg-primary transition-all"
                  style={{ width: `${(inProgress / route.segments.length) * 100}%` }}
                />
              </div>
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {completed}/{route.segments.length} completados · {totalDistanceKm.toFixed(1)} km
          </span>
        </div>

        {/* Filters row */}
        <div className="flex gap-2 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="h-7 text-xs pl-6"
            />
          </div>
          <Button
            size="sm"
            variant={sortByDistance ? 'default' : 'outline'}
            onClick={() => { setSortByDistance((v) => !v); setSortByProximity(false); }}
            className="h-7 text-[10px] gap-1 px-2"
            title="Ordenar por longitud del tramo"
          >
            <ArrowUpDown className="w-3 h-3" />
            km
          </Button>
          <Button
            size="sm"
            variant={sortByProximity ? 'default' : 'outline'}
            onClick={() => { setSortByProximity((v) => !v); setSortByDistance(false); }}
            className="h-7 text-[10px] gap-1 px-2"
            title="Ordenar por proximidad al vehículo"
            disabled={!geo.position}
          >
            <Navigation className="w-3 h-3" />
            GPS
          </Button>
        </div>

        {/* Status filter chips */}
        <div className="flex gap-0.5 mb-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setStatusFilter(opt.value);
                try { localStorage.setItem('vialroute_segments_filter', opt.value); } catch {}
              }}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleGoToNearest}
            disabled={!recommendedSegmentId}
            className="h-7 text-[10px] gap-1 flex-1"
          >
            <Navigation className="w-3 h-3" />
            Ir al más cercano
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCenterMapOnVisible}
            className="h-7 text-[10px] gap-1 flex-1"
          >
            <Crosshair className="w-3 h-3" />
            Centrar mapa
          </Button>
        </div>
      </div>

      {/* Campaign summary */}
      <CampaignSummary
        total={route.segments.length}
        pending={pending}
        inProgress={inProgress}
        completed={completed}
        incidents={incidents.length}
        possibleRepeat={possibleRepeat}
      />

      {/* Recommended segment banner */}
      {recommendedSegmentId && (() => {
        const recSeg = route.segments.find((s) => s.id === recommendedSegmentId);
        const recDist = vehicleDistanceMap.get(recommendedSegmentId);
        if (!recSeg) return null;
        return (
          <div
            className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20 cursor-pointer hover:bg-primary/15 transition-colors"
            onClick={handleGoToNearest}
          >
            <Star className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary truncate">Siguiente recomendado</p>
              <p className="text-[10px] text-foreground truncate">{recSeg.name}</p>
            </div>
            {recDist !== undefined && (
              <span className="text-[10px] font-mono text-primary flex-shrink-0">
                {formatDistance(recDist)}
              </span>
            )}
          </div>
        );
      })()}

      {/* Selection toolbar */}
      {selectedIds.size > 0 && (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          selectedIds={selectedIds}
          availableLayers={allLayerNames}
          totalDistanceKm={selectedDistanceKm}
          onMerge={onMergeSegments}
          onBulkDelete={onBulkDelete}
          onBulkMove={onBulkMove}
          onBulkColor={onBulkColor}
          onDuplicate={onDuplicate}
          onReorder={onReorder}
          onClearSelection={() => onSelectedIdsChange(new Set())}
        />
      )}

      {/* Layer panel – main content */}
      <div className="flex-1 overflow-hidden">
        <LayerPanel
          segments={filtered}
          incidents={incidents}
          selectedIds={selectedIds}
          availableLayers={route.availableLayers}
          hiddenLayers={hiddenLayers}
          onHiddenLayersChange={onHiddenLayersChange}
          onToggleSelect={toggleSelect}
          onSelectMultiple={selectMultiple}
          onEditSegment={setEditingSeg}
          onViewOnMap={(segId) => {
            onSetActiveSegment(segId);
            navigate('/map');
          }}
          onResetSegment={onResetSegment}
          onDeleteSegment={onDeleteSegment}
          onRenameLayer={onRenameLayer}
          onDeleteLayer={onDeleteLayer}
          onMoveToLayer={onMoveToLayer}
          onMergeSegments={onMergeSegments}
          onAddLayer={onAddLayer}
          vehicleDistanceMap={vehicleDistanceMap}
          recommendedSegmentId={recommendedSegmentId}
        />
      </div>

      {/* Edit dialog */}
      {editingSeg && (
        <SegmentEditDialog
          segment={editingSeg}
          open={!!editingSeg}
          onOpenChange={(open) => { if (!open) setEditingSeg(null); }}
          onSave={(updates) => {
            onUpdateSegment(editingSeg.id, updates);
            setEditingSeg(null);
          }}
        />
      )}

      <AlertDialog open={showExportAlert} onOpenChange={setShowExportAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Errores de validación pre-export
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Se detectaron {exportErrors.length} problema(s) en los tramos:</p>
                <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                  {exportErrors.map((e, i) => (
                    <li key={i} className="text-destructive">• {e.segmentName}: {e.issue}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Puedes exportar con corrección automática (se asignarán tracks y timestamps faltantes).
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleExportForceAutofix}>
              Corregir y exportar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

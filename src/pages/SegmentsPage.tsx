import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentEditDialog } from '@/components/SegmentEditDialog';
import { LayerPanel } from '@/components/LayerPanel';
import { SelectionToolbar } from '@/components/SelectionToolbar';
import { Download, Search, Plus, MapPin, Wand2, ArrowUpDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exportRouteToExcel } from '@/utils/excel-export';
import { segmentDistanceKm } from '@/utils/geo-distance';
import type { AppState, Incident, Segment, SegmentStatus } from '@/types/route';

const STATUS_OPTIONS: { value: SegmentStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completado', label: 'Completados' },
];

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
}: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SegmentStatus | 'todos'>('todos');
  const [editingSeg, setEditingSeg] = useState<Segment | null>(null);
  const [sortByDistance, setSortByDistance] = useState(false);

  const route = state.route;
  const incidents = state.incidents;

  // Cache distances
  const distanceMap = useMemo(() => {
    if (!route) return new Map<string, number>();
    const m = new Map<string, number>();
    route.segments.forEach((s) => m.set(s.id, segmentDistanceKm(s.coordinates)));
    return m;
  }, [route]);

  // Filter segments (hook before early return)
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
    if (sortByDistance) {
      segs.sort((a, b) => (distanceMap.get(b.id) || 0) - (distanceMap.get(a.id) || 0));
    }
    return segs;
  }, [route, statusFilter, search, sortByDistance, distanceMap]);

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

  const handleExport = () => exportRouteToExcel(route, incidents);

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

  const pending = route.segments.filter((s) => s.status === 'pendiente').length;
  const inProgress = route.segments.filter((s) => s.status === 'en_progreso').length;
  const completed = route.segments.filter((s) => s.status === 'completado').length;

  return (
    <div className="flex flex-col h-full">
      {/* Top toolbar – Google My Maps style */}
      <div className="flex-shrink-0 px-3 py-2 bg-card border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-foreground">{route.name}</h2>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={onSimplify} className="h-7 text-[10px] gap-1">
              <Wand2 className="w-3 h-3" />
              Simplificar
            </Button>
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

        {/* Stats bar */}
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

        {/* Filters */}
        <div className="flex gap-2">
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
            onClick={() => setSortByDistance((v) => !v)}
            className="h-7 text-[10px] gap-1 px-2"
            title="Ordenar por km"
          >
            <ArrowUpDown className="w-3 h-3" />
            km
          </Button>
          <div className="flex gap-0.5">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
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
        </div>
      </div>

      {/* Selection toolbar */}
      {selectedIds.size > 0 && (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          selectedIds={selectedIds}
          availableLayers={route.availableLayers || []}
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
    </div>
  );
}

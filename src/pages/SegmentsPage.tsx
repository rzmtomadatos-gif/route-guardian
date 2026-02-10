import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/StatusBadge';
import { SegmentEditDialog } from '@/components/SegmentEditDialog';
import {
  MapPin, RotateCcw, XCircle, Download, Pencil, Filter, Trash2,
  AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { exportRouteToExcel } from '@/utils/excel-export';
import type { AppState, Incident, Segment, SegmentStatus } from '@/types/route';

interface Props {
  state: AppState;
  onResetSegment: (segmentId: string) => void;
  onCompleteSegment: (segmentId: string) => void;
  onUpdateSegment: (segmentId: string, updates: Partial<Segment>) => void;
  onUpdateIncident: (incidentId: string, updates: Partial<Incident>) => void;
  onDeleteIncident: (incidentId: string) => void;
  onSetActiveSegment: (segmentId: string) => void;
}

const STATUS_OPTIONS: { value: SegmentStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendiente', label: 'Pendientes' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completado', label: 'Completados' },
];

export default function SegmentsPage({
  state,
  onResetSegment,
  onCompleteSegment,
  onUpdateSegment,
  onUpdateIncident,
  onDeleteIncident,
  onSetActiveSegment,
}: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SegmentStatus | 'todos'>('todos');
  const [editingSeg, setEditingSeg] = useState<Segment | null>(null);
  const [expandedIncidents, setExpandedIncidents] = useState<string | null>(null);
  const [editingIncident, setEditingIncident] = useState<string | null>(null);
  const [incidentNote, setIncidentNote] = useState('');

  if (!state.route) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="text-muted-foreground mb-4">No hay ruta cargada</p>
        <Button onClick={() => navigate('/')} className="bg-primary text-primary-foreground">
          Cargar archivo
        </Button>
      </div>
    );
  }

  const { route, incidents } = state;

  // Sort by trackNumber
  const allSegments = [...route.segments].sort((a, b) => a.trackNumber - b.trackNumber);

  // Filter
  const filtered = allSegments.filter((seg) => {
    if (statusFilter !== 'todos' && seg.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        seg.name.toLowerCase().includes(q) ||
        seg.kmlId.toLowerCase().includes(q) ||
        String(seg.trackNumber).includes(q)
      );
    }
    return true;
  });

  const getIncidents = (segId: string): Incident[] =>
    incidents.filter((i) => i.segmentId === segId);

  const handleExport = () => {
    exportRouteToExcel(route, incidents);
  };

  const handleStartEditIncident = (inc: Incident) => {
    setEditingIncident(inc.id);
    setIncidentNote(inc.note || '');
  };

  const handleSaveIncidentNote = (incId: string) => {
    onUpdateIncident(incId, { note: incidentNote });
    setEditingIncident(null);
  };

  const pending = route.segments.filter((s) => s.status === 'pendiente').length;
  const inProgress = route.segments.filter((s) => s.status === 'en_progreso').length;
  const completed = route.segments.filter((s) => s.status === 'completado').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 bg-card border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Tramos</h2>
          <Button size="sm" variant="outline" onClick={handleExport} className="border-border text-foreground">
            <Download className="w-4 h-4 mr-1" />
            Excel
          </Button>
        </div>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
          <span>{pending} pendientes</span>
          <span className="text-primary">{inProgress} en progreso</span>
          <span className="text-success">{completed} completados</span>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tramo..."
            className="h-8 text-xs flex-1"
          />
          <div className="flex gap-1">
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

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-border">
          {filtered.map((seg) => {
            const segIncidents = getIncidents(seg.id);
            const isExpanded = expandedIncidents === seg.id;
            return (
              <div key={seg.id}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
                    <span className="text-xs font-bold text-secondary-foreground">{seg.trackNumber}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {seg.kmlId && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">
                          {seg.kmlId}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{seg.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={seg.status} />
                      <span className="text-[10px] text-muted-foreground capitalize">{seg.type} · {seg.direction}</span>
                      {segIncidents.length > 0 && (
                        <button
                          onClick={() => setExpandedIncidents(isExpanded ? null : seg.id)}
                          className="text-[10px] text-destructive flex items-center gap-0.5"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {segIncidents.length}
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                    {seg.notes && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 italic truncate">{seg.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingSeg(seg)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Editar tramo"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        onSetActiveSegment(seg.id);
                        navigate('/map');
                      }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-accent hover:bg-accent/10 transition-colors"
                      title="Ver en mapa"
                    >
                      <MapPin className="w-4 h-4" />
                    </button>
                    {seg.status === 'completado' && (
                      <button
                        onClick={() => onResetSegment(seg.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Repetir tramo"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                    {seg.status === 'en_progreso' && (
                      <button
                        onClick={() => onResetSegment(seg.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Anular grabación"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded incidents */}
                {isExpanded && segIncidents.length > 0 && (
                  <div className="px-4 pb-3 space-y-1.5">
                    {segIncidents.map((inc) => (
                      <div key={inc.id} className="flex items-start gap-2 bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-foreground capitalize">{inc.category.replace('_', ' ')}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(inc.timestamp).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {editingIncident === inc.id ? (
                            <div className="flex gap-1 mt-1">
                              <Input
                                value={incidentNote}
                                onChange={(e) => setIncidentNote(e.target.value)}
                                className="h-7 text-xs flex-1"
                                placeholder="Nota..."
                                autoFocus
                              />
                              <Button size="sm" className="h-7 px-2 text-xs bg-primary text-primary-foreground" onClick={() => handleSaveIncidentNote(inc.id)}>
                                OK
                              </Button>
                            </div>
                          ) : (
                            inc.note && <p className="text-[10px] text-muted-foreground">{inc.note}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => handleStartEditIncident(inc)}
                            className="p-1 rounded text-muted-foreground hover:text-primary"
                            title="Editar nota"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => onDeleteIncident(inc.id)}
                            className="p-1 rounded text-muted-foreground hover:text-destructive"
                            title="Eliminar incidencia"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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

import { useState } from 'react';
import {
  Layers, ChevronDown, ChevronRight, Plus, Pencil, Trash2,
  MoreVertical, Eye, EyeOff, Merge, MapPin, AlertTriangle,
  Check, X, GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/StatusBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Segment, Incident } from '@/types/route';

import { getSafeLayerColor } from '@/utils/segment-colors';

function getLayerColor(index: number): string {
  return getSafeLayerColor(index);
}

interface LayerPanelProps {
  segments: Segment[];
  incidents: Incident[];
  selectedIds: Set<string>;
  availableLayers?: string[];
  hiddenLayers: Set<string>;
  onHiddenLayersChange: (layers: Set<string>) => void;
  onToggleSelect: (id: string) => void;
  onSelectMultiple: (ids: string[]) => void;
  onEditSegment: (seg: Segment) => void;
  onViewOnMap: (segId: string) => void;
  onResetSegment: (segId: string) => void;
  onDeleteSegment: (segId: string) => void;
  onRenameLayer: (oldName: string, newName: string) => void;
  onDeleteLayer: (name: string) => void;
  onMoveToLayer: (segId: string, layer: string | undefined) => void;
  onMergeSegments: (ids: string[]) => void;
  onAddLayer: (name: string) => void;
  /** Distance from vehicle to each segment start (meters) */
  vehicleDistanceMap?: Map<string, number>;
  /** ID of the recommended next segment */
  recommendedSegmentId?: string | null;
  /** Display order map: segmentId → 1-based route position */
  displayOrderMap?: Map<string, number>;
}

function formatDistanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

interface LayerGroup {
  name: string;
  segments: Segment[];
}

export function LayerPanel({
  segments,
  incidents,
  selectedIds,
  availableLayers = [],
  hiddenLayers,
  onHiddenLayersChange,
  onToggleSelect,
  onSelectMultiple,
  onEditSegment,
  onViewOnMap,
  onResetSegment,
  onDeleteSegment,
  onRenameLayer,
  onDeleteLayer,
  onMoveToLayer,
  onMergeSegments,
  onAddLayer,
  vehicleDistanceMap,
  recommendedSegmentId,
  displayOrderMap,
}: LayerPanelProps) {
  // Start with all layers collapsed; initialize lazily from group names
  const [collapsedInit, setCollapsedInit] = useState(false);
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(new Set());
  // hiddenLayers is now controlled via props
  const [renamingLayer, setRenamingLayer] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAddLayer, setShowAddLayer] = useState(false);
  const [newLayerName, setNewLayerName] = useState('');
  const [moveDialogSeg, setMoveDialogSeg] = useState<Segment | null>(null);
  const [moveTargetLayer, setMoveTargetLayer] = useState<string>('');
  const [sameNamePrompt, setSameNamePrompt] = useState<{ name: string; ids: string[] } | null>(null);
  const [deleteLayerConfirm, setDeleteLayerConfirm] = useState<string | null>(null);
  const handleToggleWithSameNameCheck = (seg: Segment) => {
    // If already selected, just deselect
    if (selectedIds.has(seg.id)) {
      onToggleSelect(seg.id);
      return;
    }
    // Find all segments with same name
    const sameNameSegs = segments.filter((s) => s.name === seg.name && s.id !== seg.id);
    if (sameNameSegs.length > 0) {
      setSameNamePrompt({
        name: seg.name,
        ids: [seg.id, ...sameNameSegs.map((s) => s.id)],
      });
    } else {
      onToggleSelect(seg.id);
    }
  };

  // Group segments by layer
  const layerGroups: LayerGroup[] = [];
  const layerMap = new Map<string, Segment[]>();
  const noLayer: Segment[] = [];

  segments.forEach((seg) => {
    if (seg.layer) {
      if (!layerMap.has(seg.layer)) layerMap.set(seg.layer, []);
      layerMap.get(seg.layer)!.push(seg);
    } else {
      noLayer.push(seg);
    }
  });

  // Sort layers alphabetically
  const layerNames = Array.from(layerMap.keys()).sort();
  layerNames.forEach((name) => {
    layerGroups.push({ name, segments: layerMap.get(name)! });
  });
  // Add empty layers from availableLayers that have no segments
  availableLayers.forEach((name) => {
    if (!layerMap.has(name)) {
      layerGroups.push({ name, segments: [] });
    }
  });
  if (noLayer.length > 0) {
    layerGroups.push({ name: 'Sin capa', segments: noLayer });
  }

  // Auto-collapse all layers on first render
  if (!collapsedInit && layerGroups.length > 0) {
    setCollapsedInit(true);
    setCollapsedLayers(new Set(layerGroups.map((g) => g.name)));
  }

  const allLayerNames = [...new Set([...layerNames, ...availableLayers])].sort();

  const toggleCollapse = (name: string) => {
    setCollapsedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleVisibility = (name: string) => {
    const next = new Set(hiddenLayers);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onHiddenLayersChange(next);
  };

  const startRename = (name: string) => {
    setRenamingLayer(name);
    setRenameValue(name);
  };

  const confirmRename = () => {
    if (renamingLayer && renameValue.trim() && renameValue !== renamingLayer) {
      onRenameLayer(renamingLayer, renameValue.trim());
    }
    setRenamingLayer(null);
  };

  const handleAddLayer = () => {
    if (newLayerName.trim()) {
      onAddLayer(newLayerName.trim());
      setNewLayerName('');
      setShowAddLayer(false);
    }
  };

  const handleMerge = () => {
    if (selectedIds.size >= 2) {
      onMergeSegments(Array.from(selectedIds));
    }
  };

  const getIncidentCount = (segId: string) =>
    incidents.filter((i) => i.segmentId === segId).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Capas</span>
          <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-full">
            {layerGroups.filter((g) => !hiddenLayers.has(g.name)).length}/{layerGroups.length} visibles
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Show all layers
              onHiddenLayersChange(new Set());
            }}
            className="h-7 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
            title="Mostrar todas las capas"
          >
            <Eye className="w-3 h-3 mr-0.5" />
            Todo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // Hide all layers
              const allNames = new Set(layerGroups.map((g) => g.name));
              onHiddenLayersChange(allNames);
            }}
            className="h-7 px-1.5 text-[10px] text-muted-foreground hover:text-primary"
            title="Ocultar todas las capas"
          >
            <EyeOff className="w-3 h-3 mr-0.5" />
            Todo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowAddLayer(true)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Add layer inline */}
      {showAddLayer && (
        <div className="flex items-center gap-1 px-3 py-2 bg-secondary/50 border-b border-border">
          <Input
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            placeholder="Nombre de la capa..."
            className="h-7 text-xs flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddLayer();
              if (e.key === 'Escape') setShowAddLayer(false);
            }}
          />
          <Button size="sm" className="h-7 w-7 p-0" onClick={handleAddLayer}>
            <Check className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowAddLayer(false)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Layer groups */}
      <div className="flex-1 overflow-y-auto">
        {layerGroups.map((group, groupIdx) => {
          const isCollapsed = collapsedLayers.has(group.name);
          const isHidden = hiddenLayers.has(group.name);
          const isNoLayer = group.name === 'Sin capa';
          const color = getLayerColor(groupIdx);
          const completedCount = group.segments.filter((s) => s.status === 'completado').length;
          const totalCount = group.segments.length;

          return (
            <div key={group.name} className="border-b border-border">
              {/* Layer header */}
              <div
                className="flex items-center gap-1 px-3 py-2 hover:bg-secondary/50 transition-colors cursor-pointer group"
                onClick={() => toggleCollapse(group.name)}
              >
                <button className="p-0.5 text-muted-foreground">
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                {renamingLayer === group.name ? (
                  <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="h-6 text-xs flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename();
                        if (e.key === 'Escape') setRenamingLayer(null);
                      }}
                    />
                    <button onClick={confirmRename} className="p-0.5 text-primary"><Check className="w-3 h-3" /></button>
                    <button onClick={() => setRenamingLayer(null)} className="p-0.5 text-muted-foreground"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <>
                    <span className="text-xs font-medium text-foreground flex-1 truncate">
                      {group.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {completedCount}/{totalCount}
                    </span>
                  </>
                )}
                <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  {group.segments.length > 0 && (
                    <button
                      onClick={() => {
                        const layerIds = group.segments.map((s) => s.id);
                        const allSelected = layerIds.every((id) => selectedIds.has(id));
                        if (allSelected) {
                          // Deselect all in this layer
                          layerIds.forEach((id) => { if (selectedIds.has(id)) onToggleSelect(id); });
                        } else {
                          onSelectMultiple(layerIds);
                        }
                      }}
                      className="p-1 rounded text-muted-foreground hover:text-primary"
                      title={group.segments.every((s) => selectedIds.has(s.id)) ? 'Deseleccionar capa' : 'Seleccionar toda la capa'}
                    >
                      <Check className={`w-3 h-3 ${group.segments.length > 0 && group.segments.every((s) => selectedIds.has(s.id)) ? 'text-primary' : ''}`} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleVisibility(group.name)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground"
                  >
                    {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  {!isNoLayer && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded text-muted-foreground hover:text-foreground">
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => startRename(group.name)}>
                          <Pencil className="w-3 h-3 mr-2" /> Renombrar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteLayerConfirm(group.name)}
                        >
                          <Trash2 className="w-3 h-3 mr-2" /> Eliminar capa
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              {/* Segments in this layer */}
              {!isCollapsed && !isHidden && (
                <div className="pb-1">
                  {group.segments.map((seg) => {
                    const isSelected = selectedIds.has(seg.id);
                    const incCount = getIncidentCount(seg.id);
                    const isRecommended = recommendedSegmentId === seg.id;
                    const vehDist = vehicleDistanceMap?.get(seg.id);
                    const displayOrder = displayOrderMap?.get(seg.id);
                    return (
                      <div
                        key={seg.id}
                        className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md transition-colors cursor-pointer hover:bg-secondary/60 ${
                          isRecommended ? 'bg-primary/10 ring-1 ring-primary/30' :
                          isSelected ? 'bg-accent/10 ring-1 ring-accent/30' : ''
                        }`}
                        onClick={() => handleToggleWithSameNameCheck(seg)}
                      >
                        <div
                          className="w-1 h-8 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-medium text-foreground truncate">{seg.name}</p>
                            {isRecommended && (
                              <span className="text-[8px] bg-primary/20 text-primary px-1 py-0.5 rounded font-semibold">
                                REC
                              </span>
                            )}
                            {seg.trackNumber !== null && (
                              <span className="text-[9px] bg-primary/15 text-primary px-1 py-0.5 rounded font-mono">
                                T{seg.trackNumber}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <StatusBadge status={seg.status} nonRecordable={seg.nonRecordable} needsRepeat={seg.needsRepeat} />
                            {vehDist !== undefined && (
                              <span className="text-[9px] text-accent-foreground/70 font-mono">
                                {formatDistanceLabel(vehDist)}
                              </span>
                            )}
                            {seg.kmlMeta?.pkInicial && (
                              <span className="text-[9px] text-muted-foreground">
                                PK {seg.kmlMeta.pkInicial}→{seg.kmlMeta.pkFinal}
                              </span>
                            )}
                            {incCount > 0 && (
                              <span className="text-[9px] text-destructive flex items-center gap-0.5">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                {incCount}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onViewOnMap(seg.id)}
                            className="p-1 rounded text-muted-foreground hover:text-accent"
                            title="Ver en mapa"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="p-1 rounded text-muted-foreground hover:text-foreground">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => onEditSegment(seg)}>
                                <Pencil className="w-3 h-3 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setMoveDialogSeg(seg)}>
                                <Layers className="w-3 h-3 mr-2" /> Mover a capa...
                              </DropdownMenuItem>
                              {seg.status === 'completado' && (
                                <DropdownMenuItem onClick={() => onResetSegment(seg.id)}>
                                  Repetir tramo
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => onDeleteSegment(seg.id)}
                              >
                                <Trash2 className="w-3 h-3 mr-2" /> Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Move to layer dialog */}
      <Dialog open={!!moveDialogSeg} onOpenChange={(open) => { if (!open) setMoveDialogSeg(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Mover a capa</DialogTitle>
          </DialogHeader>
          <Select value={moveTargetLayer} onValueChange={setMoveTargetLayer}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecciona capa..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin capa</SelectItem>
              {allLayerNames.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                if (moveDialogSeg) {
                  onMoveToLayer(moveDialogSeg.id, moveTargetLayer === '__none__' ? undefined : moveTargetLayer);
                  setMoveDialogSeg(null);
                }
              }}
            >
              Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Same-name selection dialog */}
      <Dialog open={!!sameNamePrompt} onOpenChange={(open) => { if (!open) setSameNamePrompt(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Seleccionar tramos</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Hay {sameNamePrompt?.ids.length} tramos con el nombre <strong className="text-foreground">"{sameNamePrompt?.name}"</strong>. ¿Deseas seleccionarlos todos?
          </p>
          <DialogFooter className="gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (sameNamePrompt) {
                  onToggleSelect(sameNamePrompt.ids[0]);
                  setSameNamePrompt(null);
                }
              }}
            >
              Solo este
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (sameNamePrompt) {
                  onSelectMultiple(sameNamePrompt.ids);
                  setSameNamePrompt(null);
                }
              }}
            >
              Todos ({sameNamePrompt?.ids.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete layer confirmation */}
      <Dialog open={!!deleteLayerConfirm} onOpenChange={(open) => { if (!open) setDeleteLayerConfirm(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Eliminar capa</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            ¿Eliminar la capa <strong className="text-foreground">"{deleteLayerConfirm}"</strong>? Los tramos dentro quedarán sin capa asignada.
          </p>
          <DialogFooter className="gap-2">
            <Button size="sm" variant="outline" onClick={() => setDeleteLayerConfirm(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (deleteLayerConfirm) {
                  onDeleteLayer(deleteLayerConfirm);
                  setDeleteLayerConfirm(null);
                }
              }}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
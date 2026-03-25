import { useState, useMemo } from 'react';
import { Bug, ChevronDown, ChevronUp, Route, ArrowRight, ArrowLeft, Trophy, BarChart3, CheckCircle2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OptimizerDebugInfo } from '@/utils/optimizer-debug';
import type { Segment } from '@/types/route';

interface Props {
  debugInfo: OptimizerDebugInfo | null;
  segments: Segment[];
  onApplyRoute?: (routeId: string, segmentIds: string[]) => void;
  appliedRouteId?: string | null;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export function OptimizerDebugPanel({ debugInfo, segments, onApplyRoute, appliedRouteId }: Props) {
  const [open, setOpen] = useState(false);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  const segMap = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);

  if (!debugInfo) return null;

  const { corridors, activeBlock, activeSegmentId, activeCorridorId, candidateComparison } = debugInfo;

  const activeCorridor = corridors.find((c) => c.corridorId === activeCorridorId);

  const candidateCount = candidateComparison?.candidates.length ?? 0;

  return (
    <div className="absolute bottom-20 left-2 right-2 z-30 pointer-events-none">
      <div className="pointer-events-auto bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg max-h-[60vh] overflow-hidden">
        {/* Header toggle */}
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Bug className="w-3.5 h-3.5 text-orange-400" />
            Debug Optimizador
            {corridors.length > 0 && (
              <span className="bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded text-[10px]">
                {corridors.length} corredor{corridors.length !== 1 ? 'es' : ''}
              </span>
            )}
            {candidateCount > 0 && (
              <span className="bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded text-[10px]">
                {candidateCount} rutas
              </span>
            )}
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {open && (
          <div className="px-3 pb-3 overflow-y-auto max-h-[50vh] space-y-3 text-[11px]">

            {/* === TOP 5 CANDIDATE ROUTES (selectable) === */}
            {candidateComparison && candidateComparison.candidates.length > 0 && (
              <div className="border border-emerald-500/30 rounded p-2 bg-emerald-500/5">
                <h4 className="font-bold text-emerald-400 mb-1.5 flex items-center gap-1 text-xs">
                  <BarChart3 className="w-3.5 h-3.5" />
                  Rutas candidatas ({candidateComparison.candidates.length})
                </h4>
                <div className="space-y-1.5">
                  {candidateComparison.candidates.map((c) => {
                    const isChosen = c.id === candidateComparison.chosenId;
                    const isApplied = c.id === appliedRouteId;
                    const isExpanded = expandedRoute === c.id;
                    const hasPenalties = c.corridorIntegrityPenalty > 0 || c.maneuverPenalty > 0;

                    return (
                      <div key={c.id} className="rounded overflow-hidden">
                        {/* Route summary row */}
                        <div
                          onClick={() => setExpandedRoute(isExpanded ? null : c.id)}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-t cursor-pointer ${
                            isApplied
                              ? 'bg-primary/20 border border-primary/40'
                              : isChosen
                                ? 'bg-emerald-500/15 border border-emerald-500/40'
                                : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                          }`}
                        >
                          {isApplied ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          ) : isChosen ? (
                            <Trophy className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                          ) : null}
                          <div className="flex-1 min-w-0">
                            <div className={`font-semibold truncate ${
                              isApplied ? 'text-primary' : isChosen ? 'text-emerald-400' : 'text-foreground'
                            }`}>
                              {c.label}
                              {isApplied && <span className="text-[9px] ml-1 text-primary/70">● ACTIVA</span>}
                            </div>
                            <div className="text-muted-foreground text-[9px] truncate">
                              {c.description}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className={`font-mono font-bold text-[10px] ${
                              isApplied ? 'text-primary' : isChosen ? 'text-emerald-400' : 'text-foreground'
                            }`}>
                              {(c.finalScore / 1000).toFixed(1)} km-eq
                            </div>
                            <div className="text-[9px] text-muted-foreground">
                              {(c.transitionDistanceM / 1000).toFixed(1)} km muertos
                            </div>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="bg-muted/20 border-x border-b border-border/50 rounded-b px-2 py-2 space-y-1.5">
                            {/* Metrics grid */}
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Dist. total:</span>
                                <span className="font-mono">{(c.totalDriveDistanceM / 1000).toFixed(1)} km</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Tiempo est.:</span>
                                <span className="font-mono">{formatTime(c.totalDriveTimeS)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Km muertos:</span>
                                <span className="font-mono text-amber-400">{(c.transitionDistanceM / 1000).toFixed(1)} km</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Km tramo:</span>
                                <span className="font-mono">{(c.segmentDistanceM / 1000).toFixed(1)} km</span>
                              </div>
                            </div>

                            {/* Penalties */}
                            {hasPenalties && (
                              <div className="border-t border-border/30 pt-1 space-y-0.5">
                                <div className="text-[9px] font-semibold text-muted-foreground">Penalizaciones:</div>
                                {c.corridorIntegrityPenalty > 0 && (
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-red-400">🛣️ Rotura corredor:</span>
                                    <span className="font-mono text-red-400">+{(c.corridorIntegrityPenalty / 1000).toFixed(1)} km-eq</span>
                                  </div>
                                )}
                                {c.uTurnPenalty > 0 && (
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-amber-400">↩️ U-turns:</span>
                                    <span className="font-mono text-amber-400">+{(c.uTurnPenalty / 1000).toFixed(1)} km-eq</span>
                                  </div>
                                )}
                                {c.wrongEntryPenalty > 0 && (
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-orange-400">⚠️ Aprox. incorrecta:</span>
                                    <span className="font-mono text-orange-400">+{(c.wrongEntryPenalty / 1000).toFixed(1)} km-eq</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Scoring notes */}
                            {c.scoringNotes && c.scoringNotes.length > 0 && (
                              <div className="border-t border-border/30 pt-1">
                                <div className="text-[9px] font-semibold text-muted-foreground mb-0.5">Detalle:</div>
                                {c.scoringNotes.slice(0, 5).map((note, i) => (
                                  <div key={i} className="text-[9px] text-muted-foreground/80 truncate">
                                    • {note}
                                  </div>
                                ))}
                                {c.scoringNotes.length > 5 && (
                                  <div className="text-[9px] text-muted-foreground/50 italic">
                                    ... y {c.scoringNotes.length - 5} más
                                  </div>
                                )}
                              </div>
                            )}

                            {/* APPLY BUTTON */}
                            {onApplyRoute && !isApplied && (
                              <Button
                                size="sm"
                                variant={isChosen ? 'default' : 'outline'}
                                className="w-full h-7 text-[10px] mt-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onApplyRoute(c.id, c.segmentIds);
                                }}
                              >
                                <Play className="w-3 h-3 mr-1" />
                                Aplicar esta ruta
                              </Button>
                            )}
                            {isApplied && (
                              <div className="text-center text-[9px] text-primary font-semibold mt-1">
                                ✓ Ruta operativa activa
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-emerald-400/80 text-[10px] mt-1.5 italic">
                  ✓ {candidateComparison.reason}
                </p>
              </div>
            )}

            {/* Active block */}
            <div>
              <h4 className="font-bold text-foreground mb-1 flex items-center gap-1">
                <Route className="w-3 h-3 text-primary" />
                Bloque activo ({activeBlock.length} tramos)
              </h4>
              <div className="space-y-0.5">
                {activeBlock.map((id, i) => {
                  const seg = segMap.get(id);
                  const isActive = id === activeSegmentId;
                  const dir = debugInfo.segmentDirectionMap.get(id);
                  const corr = debugInfo.segmentCorridorMap.get(id);
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-primary/20 text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      <span className="font-mono text-[10px] w-4 text-right">{i + 1}.</span>
                      <span className="truncate flex-1">{seg?.name || id.slice(0, 8)}</span>
                      {dir && (
                        <span className={`text-[9px] px-1 rounded ${
                          dir === 'A' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {dir === 'A' ? '→A' : '←B'}
                        </span>
                      )}
                      {corr && (
                        <span className="text-[9px] text-muted-foreground/60">
                          {corridors.find((c) => c.corridorId === corr)?.roadName?.slice(0, 15) || ''}
                        </span>
                      )}
                    </div>
                  );
                })}
                {activeBlock.length === 0 && (
                  <p className="text-muted-foreground/60 italic">Sin bloque activo</p>
                )}
              </div>
            </div>

            {/* Active corridor detail */}
            {activeCorridor && (
              <div className="border border-orange-500/30 rounded p-2 bg-orange-500/5">
                <h4 className="font-bold text-orange-400 mb-1 text-xs">
                  🛣️ Corredor activo: {activeCorridor.roadName}
                </h4>
                <p className="text-muted-foreground text-[10px] mb-1.5">
                  {activeCorridor.explanation}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-blue-400 font-semibold flex items-center gap-1">
                      <ArrowRight className="w-3 h-3" /> Sentido A ({activeCorridor.directionA.length})
                    </span>
                    {activeCorridor.directionA.map((id) => (
                      <div key={id} className={`text-[10px] pl-4 ${id === activeSegmentId ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                        {segMap.get(id)?.name || id.slice(0, 8)}
                      </div>
                    ))}
                  </div>
                  <div>
                    <span className="text-amber-400 font-semibold flex items-center gap-1">
                      <ArrowLeft className="w-3 h-3" /> Sentido B ({activeCorridor.directionB.length})
                    </span>
                    {activeCorridor.directionB.map((id) => (
                      <div key={id} className={`text-[10px] pl-4 ${id === activeSegmentId ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                        {segMap.get(id)?.name || id.slice(0, 8)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* All corridors */}
            {corridors.length > 0 && (
              <div>
                <h4 className="font-bold text-foreground mb-1">Corredores detectados</h4>
                {corridors.map((c) => (
                  <div
                    key={c.corridorId}
                    className={`px-2 py-1.5 rounded mb-1 border ${
                      c.corridorId === activeCorridorId
                        ? 'border-orange-500/40 bg-orange-500/10'
                        : 'border-border bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{c.roadName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.totalSegments} tramos
                      </span>
                    </div>
                    <div className="flex gap-2 mt-0.5 text-[10px]">
                      <span className="text-blue-400">A: {c.directionA.length}</span>
                      <span className="text-amber-400">B: {c.directionB.length}</span>
                      {c.hasReturn && <span className="text-green-400">↩ retorno</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {corridors.length === 0 && (
              <p className="text-muted-foreground/60 italic text-center py-2">
                No se detectaron corredores viales
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

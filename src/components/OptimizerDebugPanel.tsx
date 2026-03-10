import { useState, useMemo } from 'react';
import { Bug, ChevronDown, ChevronUp, Route, ArrowRight, ArrowLeft } from 'lucide-react';
import type { OptimizerDebugInfo } from '@/utils/optimizer-debug';
import type { Segment } from '@/types/route';

interface Props {
  debugInfo: OptimizerDebugInfo | null;
  segments: Segment[];
}

export function OptimizerDebugPanel({ debugInfo, segments }: Props) {
  const [open, setOpen] = useState(false);

  const segMap = useMemo(() => new Map(segments.map((s) => [s.id, s])), [segments]);

  if (!debugInfo) return null;

  const { corridors, activeBlock, activeSegmentId, activeCorridorId } = debugInfo;

  const activeCorridor = corridors.find((c) => c.corridorId === activeCorridorId);

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
          </span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {open && (
          <div className="px-3 pb-3 overflow-y-auto max-h-[50vh] space-y-3 text-[11px]">
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

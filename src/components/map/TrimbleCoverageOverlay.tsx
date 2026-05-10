/**
 * TrimbleCoverageOverlay — panel flotante sobre el mapa que muestra la
 * cobertura GPS por tramo durante (en vivo) y después del cierre de una
 * sesión de grabación continua Trimble.
 *
 * - Se renderiza solo en modo TRIMBLE_LIDAR.
 * - Mientras `activeTrimbleRecordingId` está activo: análisis en vivo
 *   sobre los puntos GPS marcados con esa sesión.
 * - Tras cerrar: muestra el último informe persistido (capturas gps_auto
 *   creadas con `recordingSessionId` de la última sesión cerrada).
 *
 * Reglas operativas:
 *   - Solo considera tramos pendientes/repetir, no terminales, no
 *     bloqueados por incidencia, no nonRecordable.
 *   - Color por ratio: verde ≥0.7, ámbar 0.4–0.7, rojo <0.4
 *     (alineado con códigos operativos VialRoute).
 */
import { useMemo } from 'react';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { analyzeTrimbleGpsCoverage } from '@/utils/trimble/gps-coverage';
import { Activity, CircleDot } from 'lucide-react';

function ratioBadge(ratio: number): string {
  if (ratio >= 0.7) return 'bg-emerald-500/90';
  if (ratio >= 0.4) return 'bg-amber-500/90';
  return 'bg-rose-500/90';
}

export function TrimbleCoverageOverlay() {
  const { state } = useRouteStateContext();

  const data = useMemo(() => {
    if (state.acquisitionMode !== 'TRIMBLE_LIDAR') return null;
    if (!state.route) return null;
    const recordingId = state.activeTrimbleRecordingId ?? null;
    const lastClosed = recordingId
      ? null
      : (state.trimbleRecordingSessions ?? [])
          .filter((r) => r.endedAt !== null)
          .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))[0] ?? null;
    const targetId = recordingId ?? lastClosed?.id ?? null;
    if (!targetId) return null;

    const runId = recordingId
      ? state.activeRunId
      : lastClosed?.runId ?? null;
    if (!runId) return null;

    const TERMINAL = new Set(['capturado_pendiente_proceso', 'no_capturable', 'en_captura']);
    const capByseg = new Map<string, typeof state.trimbleSegmentCaptures>();
    for (const c of state.trimbleSegmentCaptures ?? []) {
      const arr = capByseg.get(c.segmentId) ?? [];
      arr.push(c);
      capByseg.set(c.segmentId, arr);
    }
    const blocked = new Set<string>();
    for (const inc of state.trimbleIncidents ?? []) {
      if (inc.segmentId && (inc.severity === 'bloqueante' || inc.invalidatesRun)) blocked.add(inc.segmentId);
    }
    const eligible = state.route.segments.filter((seg) => {
      if (seg.nonRecordable) return false;
      if (blocked.has(seg.id)) return false;
      const arr = capByseg.get(seg.id) ?? [];
      if (arr.length === 0) return true;
      for (const c of arr) {
        if (TERMINAL.has(c.fieldStatus)) return false;
        if (c.qaStatus === 'procesado_ok' || c.qaStatus === 'descartado_por_calidad') return false;
      }
      return true;
    });

    if (recordingId) {
      const points = (state.trimbleGpsLogsByRun?.[runId] ?? []).filter(
        (p) => p.recordingSessionId === recordingId && p.phase === 'capture',
      );
      const report = analyzeTrimbleGpsCoverage(points, eligible);
      return {
        live: true,
        sessionId: recordingId,
        pointsCount: points.length,
        captured: report.captured.map((c) => ({
          segmentId: c.segmentId,
          ratio: c.coverageRatio,
          startProgress: c.startProgress,
          endProgress: c.endProgress,
        })),
        partial: report.partial.map((p) => ({
          segmentId: p.segmentId,
          ratio: p.coverageRatio,
          reason: p.reason,
        })),
      };
    }

    // Persistido tras cierre
    const autoCaps = (state.trimbleSegmentCaptures ?? []).filter(
      (c) => c.captureSource === 'gps_auto' && c.recordingSessionId === targetId,
    );
    return {
      live: false,
      sessionId: targetId,
      pointsCount: (state.trimbleGpsLogsByRun?.[runId] ?? []).filter(
        (p) => p.recordingSessionId === targetId,
      ).length,
      captured: autoCaps.map((c) => ({
        segmentId: c.segmentId,
        ratio: c.coverageRatio ?? 1,
        startProgress: 0,
        endProgress: 1,
      })),
      partial: [] as Array<{ segmentId: string; ratio: number; reason: string }>,
    };
  }, [state]);

  if (!data) return null;

  const segName = (id: string) => state.route?.segments.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="absolute top-3 right-3 z-20 max-w-[300px] w-[280px] rounded-md border border-border bg-background/95 backdrop-blur shadow-lg pointer-events-auto">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {data.live ? <Activity className="h-4 w-4 text-emerald-500 animate-pulse" /> : <CircleDot className="h-4 w-4 text-muted-foreground" />}
        <div className="text-sm font-semibold flex-1">
          {data.live ? 'Cobertura GPS — en vivo' : 'Última grabación — cobertura'}
        </div>
        <div className="text-xs text-muted-foreground">{data.pointsCount} pts</div>
      </div>

      <div className="max-h-[280px] overflow-y-auto px-3 py-2 space-y-2 text-xs">
        {data.captured.length === 0 && data.partial.length === 0 && (
          <div className="text-muted-foreground italic">Sin tramos detectados todavía.</div>
        )}
        {data.captured.length > 0 && (
          <div>
            <div className="font-semibold text-emerald-600 mb-1">
              Cubiertos ({data.captured.length})
            </div>
            <ul className="space-y-1">
              {data.captured.map((c) => (
                <li key={`cap-${c.segmentId}`} className="flex items-center gap-2">
                  <div className="flex-1 truncate" title={segName(c.segmentId)}>{segName(c.segmentId)}</div>
                  <div className="relative w-16 h-2 rounded bg-muted overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 ${ratioBadge(c.ratio)}`}
                      style={{ width: `${Math.round(c.ratio * 100)}%` }}
                    />
                  </div>
                  <div className="w-9 text-right tabular-nums">{Math.round(c.ratio * 100)}%</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.partial.length > 0 && (
          <div>
            <div className="font-semibold text-amber-600 mb-1">
              Parciales ({data.partial.length})
            </div>
            <ul className="space-y-1">
              {data.partial.slice(0, 8).map((p) => (
                <li key={`par-${p.segmentId}`} className="flex items-center gap-2">
                  <div className="flex-1 truncate" title={segName(p.segmentId)}>{segName(p.segmentId)}</div>
                  <div className="relative w-16 h-2 rounded bg-muted overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 ${ratioBadge(p.ratio)}`}
                      style={{ width: `${Math.max(2, Math.round(p.ratio * 100))}%` }}
                    />
                  </div>
                  <div className="w-9 text-right tabular-nums text-muted-foreground" title={p.reason}>
                    {Math.round(p.ratio * 100)}%
                  </div>
                </li>
              ))}
              {data.partial.length > 8 && (
                <li className="text-muted-foreground italic">+{data.partial.length - 8} más…</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

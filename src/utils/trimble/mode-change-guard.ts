/**
 * Guard de cambio de modo de adquisición.
 *
 * El modo (`RST` | `GARMIN` | `TRIMBLE_LIDAR`) sólo puede cambiarse cuando la
 * campaña está VACÍA o no tiene ningún rastro operativo. Si hubiera datos
 * de un modo anterior, cambiar destruiría trazabilidad ⇒ se bloquea.
 *
 * Devuelve `{ ok: true }` si el cambio es seguro, o `{ ok: false, reason }`
 * con un texto en español apto para mostrar en toast.
 */
import type { AppState } from '@/types/route';

export interface ModeChangeCheck {
  ok: boolean;
  reason?: string;
}

export function canChangeAcquisitionMode(s: AppState): ModeChangeCheck {
  // Estado operativo activo
  if (s.navigationActive) return { ok: false, reason: 'Navegación activa' };
  if (s.activeSegmentId) return { ok: false, reason: 'Hay un tramo activo' };
  if (s.trackSession?.active) return { ok: false, reason: 'Track abierto' };
  if (s.blockEndPrompt?.isOpen) {
    return { ok: false, reason: 'Hay un prompt de cierre de bloque abierto' };
  }

  // Datos RST/Garmin
  if (
    s.route?.segments.some(
      (seg) => seg.status === 'completado' || seg.status === 'en_progreso',
    )
  ) {
    return { ok: false, reason: 'Existen tramos en progreso o completados' };
  }
  if (s.incidents && s.incidents.length > 0) {
    return { ok: false, reason: 'Existen incidencias registradas' };
  }
  if (s.segmentCorrections && s.segmentCorrections.length > 0) {
    return { ok: false, reason: 'Existen correcciones de gabinete' };
  }
  if (
    s.lastConsumedTrackByDay &&
    Object.values(s.lastConsumedTrackByDay).some((n) => n > 0)
  ) {
    return { ok: false, reason: 'Hay tracks consumidos en algún día' };
  }

  // GPS RST/Garmin: comprobar puntos REALES, no solo claves
  for (const byTrack of Object.values(s.trackGpsLogsByDay ?? {})) {
    for (const pts of Object.values(byTrack ?? {})) {
      if (pts && pts.length > 0) {
        return { ok: false, reason: 'Existen puntos GPS registrados' };
      }
    }
  }

  // Datos Trimble
  if (s.trimbleMissions && s.trimbleMissions.length > 0) {
    return { ok: false, reason: 'Existen misiones Trimble' };
  }
  if (s.trimbleRuns && s.trimbleRuns.length > 0) {
    return { ok: false, reason: 'Existen pasadas Trimble' };
  }
  if (s.trimbleSegmentCaptures && s.trimbleSegmentCaptures.length > 0) {
    return { ok: false, reason: 'Existen capturas Trimble' };
  }
  if (s.trimbleIncidents && s.trimbleIncidents.length > 0) {
    return { ok: false, reason: 'Existen incidencias Trimble' };
  }
  if (s.trimbleDeliverables && s.trimbleDeliverables.length > 0) {
    return { ok: false, reason: 'Existen entregables Trimble' };
  }
  if (s.activeMissionId || s.activeRunId) {
    return { ok: false, reason: 'Misión o pasada Trimble abierta' };
  }

  // GPS Trimble: puntos reales por run
  for (const pts of Object.values(s.trimbleGpsLogsByRun ?? {})) {
    if (pts && pts.length > 0) {
      return { ok: false, reason: 'Existen puntos GPS Trimble' };
    }
  }

  return { ok: true };
}

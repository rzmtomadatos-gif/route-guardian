import * as XLSX from 'xlsx';
import type { Route, Segment, Incident } from '@/types/route';
import { segmentDistanceKm } from '@/utils/geo-distance';

const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completado: 'Completado',
  posible_repetir: 'Posible repetir',
};

const DIRECTION_LABELS: Record<string, string> = {
  creciente: 'Creciente',
  ambos: 'Ambos',
};

const TYPE_LABELS: Record<string, string> = {
  tramo: 'Tramo',
  rotonda: 'Rotonda',
};

const IMPACT_LABELS: Record<string, string> = {
  informativa: 'Informativa',
  critica_no_grabable: 'Crítica (no grabable)',
  critica_invalida_bloque: 'Crítica (invalida bloque)',
};

export interface ExportValidationError {
  segmentId: string;
  segmentName: string;
  issue: string;
}

/** Validate segments before export. Returns list of issues found. */
export function validateForExport(segments: Segment[], rstMode: boolean): ExportValidationError[] {
  const errors: ExportValidationError[] = [];

  // Check completed segments missing track or timestamps
  segments.forEach((s) => {
    if (s.status !== 'completado') return;
    if (s.trackNumber === null) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Track real' });
    }
    if (!s.startedAt) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Inicio tramo' });
    }
    if (!s.endedAt) {
      errors.push({ segmentId: s.id, segmentName: s.name, issue: 'Completado sin Fin tramo' });
    }
  });

  // Check duplicate tracks in RST OFF (each completed segment should have unique track)
  if (!rstMode) {
    const completedWithTrack = segments.filter((s) => s.status === 'completado' && s.trackNumber !== null);
    const trackCounts = new Map<number, string[]>();
    completedWithTrack.forEach((s) => {
      const names = trackCounts.get(s.trackNumber!) || [];
      names.push(s.name);
      trackCounts.set(s.trackNumber!, names);
    });
    trackCounts.forEach((names, track) => {
      if (names.length > 1) {
        names.forEach((name) => {
          errors.push({ segmentId: '', segmentName: name, issue: `Track ${track} repetido (RST OFF: debe ser único)` });
        });
      }
    });
  }

  return errors;
}

/** Auto-fix completed segments missing track/timestamps. Returns fixed copies. */
function autoFixSegments(exportSegments: Segment[]): Segment[] {
  let maxTrack = 0;
  exportSegments.forEach((s) => {
    if (s.trackNumber !== null && s.trackNumber > maxTrack) maxTrack = s.trackNumber;
    s.trackHistory.forEach((t) => { if (t > maxTrack) maxTrack = t; });
  });

  return exportSegments.map((s) => {
    if (s.status !== 'completado') return s;
    const fixes: Partial<Segment> = {};
    if (s.trackNumber === null) {
      maxTrack++;
      fixes.trackNumber = maxTrack;
    }
    if (!s.startedAt) fixes.startedAt = s.timestampInicio || new Date().toISOString();
    if (!s.endedAt) fixes.endedAt = s.timestampFin || new Date().toISOString();
    return Object.keys(fixes).length > 0 ? { ...s, ...fixes } : s;
  });
}

export function exportRouteToExcel(route: Route, incidents: Incident[], selectedIds?: Set<string>) {
  const wb = XLSX.utils.book_new();

  const exportSegments = selectedIds && selectedIds.size > 0
    ? route.segments.filter((s) => selectedIds.has(s.id))
    : route.segments;

  const exportIncidents = selectedIds && selectedIds.size > 0
    ? incidents.filter((i) => selectedIds.has(i.segmentId))
    : incidents;

  // Auto-fix completed segments missing track/timestamps
  const validatedSegments = autoFixSegments(exportSegments);

  // Sheet 1: Segments
  const segData = validatedSegments.map((seg) => {
    const segIncidents = exportIncidents.filter((i) => i.segmentId === seg.id);
    const distKm = segmentDistanceKm(seg.coordinates);
    const trackReal = (seg.nonRecordable || seg.repeatRequested) ? '' : (seg.trackNumber ?? '');
    return {
      'Track': trackReal,
      'Track planificado': seg.plannedTrackNumber ?? '',
      'Tracks anteriores': seg.trackHistory.length > 0 ? seg.trackHistory.join(', ') : '',
      'ID Tramo': seg.kmlId,
      'Nombre': seg.name,
      'Capa': seg.layer || 'Sin capa',
      'Inicio tramo': seg.startedAt || seg.timestampInicio || '',
      'Fin tramo': (!seg.nonRecordable && !seg.repeatRequested) ? (seg.endedAt || seg.timestampFin || '') : '',
      'Distancia (km)': Math.round(distKm * 100) / 100,
      'Carretera': seg.kmlMeta?.carretera || '',
      'Ident. Tramo': seg.kmlMeta?.identtramo || '',
      'Tipo KML': seg.kmlMeta?.tipo || '',
      'Calzada': seg.kmlMeta?.calzada || '',
      'Sentido': seg.kmlMeta?.sentido || '',
      'PK Inicial': seg.kmlMeta?.pkInicial || '',
      'PK Final': seg.kmlMeta?.pkFinal || '',
      'Tipo': TYPE_LABELS[seg.type] || seg.type,
      'Dirección': DIRECTION_LABELS[seg.direction] || seg.direction,
      'Estado': STATUS_LABELS[seg.status] || seg.status,
      'No grabable': seg.nonRecordable ? 'Sí' : '',
      'Repetición solicitada': seg.repeatRequested ? 'Sí' : '',
      'Notas': seg.notes || '',
      'Incidencias': segIncidents.length,
      'Coord. Inicio Lat': seg.coordinates[0]?.lat ?? '',
      'Coord. Inicio Lng': seg.coordinates[0]?.lng ?? '',
      'Coord. Fin Lat': seg.coordinates[seg.coordinates.length - 1]?.lat ?? '',
      'Coord. Fin Lng': seg.coordinates[seg.coordinates.length - 1]?.lng ?? '',
    };
  });

  const ws1 = XLSX.utils.json_to_sheet(segData);
  const colWidths = Object.keys(segData[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...segData.map((r) => String((r as any)[key]).length)) + 2,
  }));
  ws1['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws1, 'Tramos');

  // Sheet 2: Incidents
  if (exportIncidents.length > 0) {
    const incData = exportIncidents.map((inc) => {
      const seg = route.segments.find((s) => s.id === inc.segmentId);
      return {
        'Track real': inc.trackAtIncident ?? '',
        'Track intento': inc.invalidatedBlock ? (inc.trackAtIncident ?? '') : '',
        'Tramo': seg?.name ?? inc.segmentId,
        'Capa': seg?.layer || 'Sin capa',
        'Categoría': inc.category,
        'Impacto': IMPACT_LABELS[inc.impact] || inc.impact,
        'Invalida bloque': inc.invalidatedBlock ? 'Sí' : 'No',
        'Nota': inc.note || '',
        'Fecha/Hora': new Date(inc.timestamp).toLocaleString('es-ES'),
        'Lat': inc.location?.lat ?? '',
        'Lng': inc.location?.lng ?? '',
      };
    });
    const ws2 = XLSX.utils.json_to_sheet(incData);
    const colWidths2 = Object.keys(incData[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...incData.map((r) => String((r as any)[key]).length)) + 2,
    }));
    ws2['!cols'] = colWidths2;
    XLSX.utils.book_append_sheet(wb, ws2, 'Incidencias');
  }

  const fileName = `${route.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_hoja_de_ruta.xlsx`;
  XLSX.writeFile(wb, fileName);
}

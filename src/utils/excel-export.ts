import * as XLSX from 'xlsx';
import type { Route, Segment, Incident } from '@/types/route';

const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completado: 'Completado',
};

const DIRECTION_LABELS: Record<string, string> = {
  creciente: 'Creciente',
  ambos: 'Ambos',
};

const TYPE_LABELS: Record<string, string> = {
  tramo: 'Tramo',
  rotonda: 'Rotonda',
};

export function exportRouteToExcel(route: Route, incidents: Incident[]) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Segments
  const segData = route.segments.map((seg) => {
    const segIncidents = incidents.filter((i) => i.segmentId === seg.id);
    return {
      'Track': seg.trackNumber,
      'ID Tramo': seg.kmlId,
      'Nombre': seg.name,
      'Tipo': TYPE_LABELS[seg.type] || seg.type,
      'Dirección': DIRECTION_LABELS[seg.direction] || seg.direction,
      'Estado': STATUS_LABELS[seg.status] || seg.status,
      'Notas': seg.notes || '',
      'Incidencias': segIncidents.length,
      'Coord. Inicio Lat': seg.coordinates[0]?.lat ?? '',
      'Coord. Inicio Lng': seg.coordinates[0]?.lng ?? '',
      'Coord. Fin Lat': seg.coordinates[seg.coordinates.length - 1]?.lat ?? '',
      'Coord. Fin Lng': seg.coordinates[seg.coordinates.length - 1]?.lng ?? '',
    };
  });

  const ws1 = XLSX.utils.json_to_sheet(segData);
  // Auto-width columns
  const colWidths = Object.keys(segData[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...segData.map((r) => String((r as any)[key]).length)) + 2,
  }));
  ws1['!cols'] = colWidths;
  XLSX.utils.book_append_sheet(wb, ws1, 'Tramos');

  // Sheet 2: Incidents
  if (incidents.length > 0) {
    const incData = incidents.map((inc) => {
      const seg = route.segments.find((s) => s.id === inc.segmentId);
      return {
        'Track': seg?.trackNumber ?? '',
        'Tramo': seg?.name ?? inc.segmentId,
        'Categoría': inc.category,
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

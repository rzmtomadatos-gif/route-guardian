/**
 * Etiquetas humanas (ES) para los campos corregibles del modelo.
 *
 * Único punto de verdad: la UI de gabinete (panel de inspección, futura
 * página /gabinete, exports) consume este mapa. Nunca se muestran al
 * usuario claves técnicas como `kmlMeta.identtramo`.
 *
 * El tipado `Record<CorrectableField, string>` garantiza que añadir un
 * nuevo campo a `CorrectableField` rompa la compilación hasta que se
 * registre aquí su etiqueta.
 */

import type { CorrectableField } from '@/types/route';

export const FIELD_LABELS: Record<CorrectableField, string> = {
  // Identificación / metadatos descriptivos
  name: 'Nombre',
  notes: 'Notas',
  kmlId: 'ID Tramo',
  companySegmentId: 'ID empresa',
  direction: 'Dirección',
  type: 'Tipo',
  'kmlMeta.carretera': 'Carretera',
  'kmlMeta.identtramo': 'Identificador tramo',
  'kmlMeta.tipo': 'Tipo (KML)',
  'kmlMeta.calzada': 'Calzada',
  'kmlMeta.sentido': 'Sentido',
  'kmlMeta.pkInicial': 'PK Inicial',
  'kmlMeta.pkFinal': 'PK Final',
  // Trazabilidad consolidada — campo real del modelo
  workDay: 'Día',
  trackNumber: 'Track',
  segmentOrder: 'Posición en track',
  status: 'Estado',
  needsRepeat: 'Necesita repetir',
  nonRecordable: 'No grabable',
  invalidatedByTrack: 'Invalidado por track',
  repeatNumber: 'Nº de repetición',
};

export function getFieldLabel(field: CorrectableField): string {
  return FIELD_LABELS[field] ?? field;
}

/** Formateo seguro de cualquier valor para mostrar en la UI de inspección. */
export function formatCorrectionValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

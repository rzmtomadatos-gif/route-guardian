/**
 * Tipos de input para cada CorrectableField.
 *
 * Mapa exhaustivo: añadir un nuevo campo a `CorrectableField` rompe
 * compilación hasta que se registre aquí su tipo de input.
 *
 * Usado por `CorrectionFieldEditor` para decidir el control adecuado.
 */

import type { CorrectableField, SegmentStatus, SegmentDirection, SegmentType } from '@/types/route';

export type FieldInputKind =
  | 'string'      // texto libre, una línea
  | 'text'        // texto largo (textarea)
  | 'number'      // entero o decimal
  | 'boolean'    // switch sí/no
  | 'status'     // SegmentStatus
  | 'direction'  // SegmentDirection
  | 'type';      // SegmentType

export const FIELD_INPUT_KIND: Record<CorrectableField, FieldInputKind> = {
  // Identificación / metadatos descriptivos
  name: 'string',
  notes: 'text',
  kmlId: 'string',
  companySegmentId: 'string',
  direction: 'direction',
  type: 'type',
  'kmlMeta.carretera': 'string',
  'kmlMeta.identtramo': 'string',
  'kmlMeta.tipo': 'string',
  'kmlMeta.calzada': 'string',
  'kmlMeta.sentido': 'string',
  'kmlMeta.pkInicial': 'string',
  'kmlMeta.pkFinal': 'string',
  // Trazabilidad consolidada
  workDay: 'number',
  trackNumber: 'number',
  segmentOrder: 'number',
  status: 'status',
  needsRepeat: 'boolean',
  nonRecordable: 'boolean',
  invalidatedByTrack: 'number',
  repeatNumber: 'number',
};

export const STATUS_OPTIONS: { value: SegmentStatus; label: string }[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completado', label: 'Completado' },
  { value: 'posible_repetir', label: 'Posible repetir' },
];

export const DIRECTION_OPTIONS: { value: SegmentDirection; label: string }[] = [
  { value: 'creciente', label: 'Creciente' },
  { value: 'ambos', label: 'Ambos sentidos' },
];

export const TYPE_OPTIONS: { value: SegmentType; label: string }[] = [
  { value: 'tramo', label: 'Tramo' },
  { value: 'rotonda', label: 'Rotonda' },
];

export function getFieldInputKind(field: CorrectableField): FieldInputKind {
  return FIELD_INPUT_KIND[field];
}

/**
 * Modelo de 3 capas — utilidades puras
 *
 * A. Histórico crudo (event-log SQLite)              → inmutable
 * B. Correcciones de gabinete (segmentCorrections)   → append-only, reversible
 * C. Resultado consolidado actual                    → DERIVADO en lectura
 *
 * Estas funciones son puras: no tocan estado global, no escriben en SQLite,
 * no emiten eventos. Todo el side-effect vive en el hook `useSegmentCorrections`.
 */

import type {
  Segment,
  SegmentCorrection,
  CorrectableField,
} from '@/types/route';
import { FIELDS_REQUIRING_REASON } from '@/types/route';

/** Genera un id simple para una corrección. */
export function generateCorrectionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return `corr-${ts}-${rand}`;
}

/** Devuelve solo las correcciones activas de un tramo, ordenadas por fecha asc. */
export function getActiveCorrections(
  segmentId: string,
  corrections: SegmentCorrection[],
): SegmentCorrection[] {
  return corrections
    .filter((c) => c.segmentId === segmentId && c.active)
    .sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));
}

/**
 * Aplica una corrección a un objeto Segment, tratando los campos `kmlMeta.*`
 * como path anidado. NO muta el segmento original.
 */
function applyFieldToSegment(
  segment: Segment,
  field: CorrectableField,
  value: unknown,
): Segment {
  if (field.startsWith('kmlMeta.')) {
    const key = field.slice('kmlMeta.'.length) as keyof Segment['kmlMeta'];
    return {
      ...segment,
      kmlMeta: { ...segment.kmlMeta, [key]: value as string | undefined },
    };
  }
  return { ...segment, [field]: value } as Segment;
}

/**
 * Lee el valor actual de un campo en el segmento (incluyendo paths kmlMeta.*).
 */
export function readFieldFromSegment(
  segment: Segment,
  field: CorrectableField,
): unknown {
  if (field.startsWith('kmlMeta.')) {
    const key = field.slice('kmlMeta.'.length) as keyof Segment['kmlMeta'];
    return segment.kmlMeta?.[key];
  }
  return (segment as unknown as Record<string, unknown>)[field];
}

/**
 * Devuelve el segmento consolidado: dato de campo + correcciones activas
 * aplicadas en orden cronológico. NO muta el original.
 */
export function getConsolidatedSegment(
  segment: Segment,
  corrections: SegmentCorrection[],
): Segment {
  const active = getActiveCorrections(segment.id, corrections);
  return active.reduce<Segment>(
    (acc, c) => applyFieldToSegment(acc, c.field, c.newValue),
    segment,
  );
}

/** Aplica la consolidación a una colección. */
export function getConsolidatedSegments(
  segments: Segment[],
  corrections: SegmentCorrection[],
): Segment[] {
  if (corrections.length === 0) return segments;
  return segments.map((s) => getConsolidatedSegment(s, corrections));
}

/** Mapa rápido { field → corrección activa } para un tramo. */
export function getActiveCorrectionsByField(
  segmentId: string,
  corrections: SegmentCorrection[],
): Map<CorrectableField, SegmentCorrection> {
  const map = new Map<CorrectableField, SegmentCorrection>();
  for (const c of getActiveCorrections(segmentId, corrections)) {
    map.set(c.field, c);
  }
  return map;
}

/** Indica si un campo corregido tiene corrección activa vigente. */
export function isFieldCorrected(
  segmentId: string,
  field: CorrectableField,
  corrections: SegmentCorrection[],
): boolean {
  return corrections.some(
    (c) => c.segmentId === segmentId && c.field === field && c.active,
  );
}

export interface ApplyCorrectionInput {
  segment: Segment;
  field: CorrectableField;
  newValue: unknown;
  reason: string;
  correctedBy: string;
  correctedByRole: 'gabinete' | 'admin';
  /** Inyección opcional para tests deterministas. */
  now?: () => Date;
  idGenerator?: () => string;
}

export interface ApplyCorrectionResult {
  /** Nueva colección de correcciones (anteriores marcadas superseded). */
  corrections: SegmentCorrection[];
  /** Corrección recién creada. */
  created: SegmentCorrection;
  /** Correcciones superseded en esta operación (para auditoría). */
  superseded: SegmentCorrection[];
}

/**
 * Aplica una corrección sobre un tramo.
 *
 * Reglas:
 *  - Si ya existe una corrección activa sobre el mismo campo, se marca con
 *    `supersededBy` apuntando a la nueva y `active: false`.
 *  - El `previousValue` se toma del consolidado vigente ANTES de aplicar.
 *  - Si el campo exige motivo y `reason` está vacío → lanza error.
 *  - Operación pura: devuelve una colección nueva, no muta la entrada.
 */
export function applyCorrection(
  existing: SegmentCorrection[],
  input: ApplyCorrectionInput,
): ApplyCorrectionResult {
  const reason = (input.reason ?? '').trim();
  if (FIELDS_REQUIRING_REASON.has(input.field) && reason.length === 0) {
    throw new Error(
      `Campo "${input.field}" requiere un motivo obligatorio para ser corregido.`,
    );
  }

  const consolidated = getConsolidatedSegment(input.segment, existing);
  const previousValue = readFieldFromSegment(consolidated, input.field);

  const now = (input.now ?? (() => new Date()))().toISOString();
  const id = (input.idGenerator ?? generateCorrectionId)();

  const created: SegmentCorrection = {
    id,
    segmentId: input.segment.id,
    field: input.field,
    previousValue,
    newValue: input.newValue,
    reason,
    correctedBy: input.correctedBy,
    correctedByRole: input.correctedByRole,
    correctedAt: now,
    active: true,
  };

  const superseded: SegmentCorrection[] = [];
  const next = existing.map((c) => {
    if (
      c.segmentId === input.segment.id &&
      c.field === input.field &&
      c.active
    ) {
      const updated: SegmentCorrection = {
        ...c,
        active: false,
        supersededBy: id,
      };
      superseded.push(updated);
      return updated;
    }
    return c;
  });

  return { corrections: [...next, created], created, superseded };
}

export interface RevertCorrectionInput {
  correctionId: string;
  revertReason: string;
  revertedBy: string;
  now?: () => Date;
}

export interface RevertCorrectionResult {
  corrections: SegmentCorrection[];
  reverted: SegmentCorrection;
}

/**
 * Revierte una corrección activa.
 *
 * Reglas:
 *  - Solo se puede revertir una corrección con `active: true`.
 *  - Marca `active: false`, registra `revertedBy/At/Reason`.
 *  - NO reactiva ninguna corrección anterior superseded (decisión explícita
 *    para no resucitar valores antiguos sin intervención del operador).
 *  - `revertReason` es obligatorio (las reversiones son eventos críticos).
 *  - Operación pura.
 */
export function revertCorrection(
  existing: SegmentCorrection[],
  input: RevertCorrectionInput,
): RevertCorrectionResult {
  const target = existing.find((c) => c.id === input.correctionId);
  if (!target) {
    throw new Error(`Corrección no encontrada: ${input.correctionId}`);
  }
  if (!target.active) {
    throw new Error(
      `La corrección ${input.correctionId} ya estaba inactiva (no puede revertirse).`,
    );
  }
  const reason = (input.revertReason ?? '').trim();
  if (reason.length === 0) {
    throw new Error('La reversión requiere un motivo obligatorio.');
  }

  const now = (input.now ?? (() => new Date()))().toISOString();

  const reverted: SegmentCorrection = {
    ...target,
    active: false,
    revertedBy: input.revertedBy,
    revertedAt: now,
    revertReason: reason,
  };

  const corrections = existing.map((c) => (c.id === target.id ? reverted : c));
  return { corrections, reverted };
}

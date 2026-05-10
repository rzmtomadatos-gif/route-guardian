/**
 * Helpers para identificar corredores (tramos compuestos) en modo Trimble.
 *
 * Regla operativa:
 *   - Una vez VialRoute entra en un corredor compuesto (p.ej. "AVDA ESPAÑA 1/8"),
 *     debe completar todas sus partes accionables antes de pasar a otra calle,
 *     incluso si una parte intermedia tiene incidencia o no es capturable.
 *
 * Estos helpers NO modifican estado; sólo derivan claves estables y orden de
 * partes a partir de los campos del Segment.
 */
import type { Segment } from '@/types/route';

const PART_PATTERN = /^(.*?)[\s_·\-]+(\d+)\s*\/\s*(\d+)\s*$/i;
const PART_PATTERN_ALT = /^(.*?)\s+parte\s+(\d+)\s*(?:\/\s*(\d+))?\s*$/i;

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Devuelve la clave estable de corredor para un tramo.
 *
 * Prioridad:
 *  1. `kmlMeta.multiPartParentName` (multipart KML — ya viene normalizado).
 *  2. Patrón "X/Y" en el nombre (`AVDA ESPAÑA 1/8` → `AVDA ESPAÑA`).
 *  3. Patrón "parte X" en el nombre.
 *  4. `kmlMeta.identtramo` si existe.
 *  5. `companySegmentId` con sufijo de parte (`BOA_00123-1` → `BOA_00123`).
 *  6. Fallback: `segment.id` (corredor individual).
 */
export function getTrimbleCorridorKey(segment: Segment): string {
  const meta = segment.kmlMeta ?? {};
  if (meta.multiPartParentName) return `MP:${normalize(meta.multiPartParentName)}`;
  const name = segment.name ?? '';
  const m = name.match(PART_PATTERN);
  if (m) return `N:${normalize(m[1])}`;
  const m2 = name.match(PART_PATTERN_ALT);
  if (m2) return `N:${normalize(m2[1])}`;
  if (meta.identtramo) return `IT:${normalize(meta.identtramo)}`;
  const csi = segment.companySegmentId;
  if (csi) {
    const cm = csi.match(/^(.+?)[\-_·\s]+\d+$/);
    if (cm) return `CS:${normalize(cm[1])}`;
  }
  return `ID:${segment.id}`;
}

/**
 * Devuelve el número de parte (1-based) si se puede inferir, o null.
 * Útil para ordenar las partes dentro del mismo corredor.
 */
export function getTrimbleCorridorPart(segment: Segment): number | null {
  const meta = segment.kmlMeta ?? {};
  if (typeof meta.multiPartIndex === 'number' && Number.isFinite(meta.multiPartIndex)) {
    return meta.multiPartIndex;
  }
  const name = segment.name ?? '';
  const m = name.match(PART_PATTERN);
  if (m) {
    const n = parseInt(m[2], 10);
    if (Number.isFinite(n)) return n;
  }
  const m2 = name.match(PART_PATTERN_ALT);
  if (m2) {
    const n = parseInt(m2[2], 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

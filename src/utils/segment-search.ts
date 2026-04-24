/**
 * Búsqueda local sobre los tramos cargados en la campaña.
 *
 * Indexa campos relevantes de `Segment` y `kmlMeta` y devuelve resultados
 * ordenados por relevancia. No hace fetch — todo en memoria.
 */
import type { Segment } from '@/types/route';
import { normalizeText, scoreMatch } from './text-search';
import { isValidLatLng } from './coord-validation';

export interface SegmentSearchResult {
  segment: Segment;
  score: number;
  /** Etiqueta corta indicando qué campo casó (para mostrar al operador). */
  matchedField: string;
}

/**
 * Campos primarios (id-like) → puntúan más alto.
 * Coincidencia exacta de id → 200, prefijo → 150, contains → 100.
 */
const ID_FIELDS: Array<{ key: string; get: (s: Segment) => unknown }> = [
  { key: 'id', get: (s) => s.id },
  { key: 'kmlId', get: (s) => s.kmlId },
  { key: 'companySegmentId', get: (s) => s.companySegmentId },
  { key: 'osmId', get: (s) => s.kmlMeta?.osmId },
  { key: 'identtramo', get: (s) => s.kmlMeta?.identtramo },
];

/** Campos secundarios (texto). Se reutiliza scoreMatch (0..100). */
const TEXT_FIELDS: Array<{ key: string; get: (s: Segment) => unknown }> = [
  { key: 'name', get: (s) => s.name },
  { key: 'layer', get: (s) => s.layer },
  { key: 'carretera', get: (s) => s.kmlMeta?.carretera },
  { key: 'ref', get: (s) => s.kmlMeta?.ref },
  { key: 'tipo', get: (s) => s.kmlMeta?.tipo },
  { key: 'calzada', get: (s) => s.kmlMeta?.calzada },
  { key: 'sentido', get: (s) => s.kmlMeta?.sentido },
  { key: 'pkInicial', get: (s) => s.kmlMeta?.pkInicial },
  { key: 'pkFinal', get: (s) => s.kmlMeta?.pkFinal },
  { key: 'notes', get: (s) => s.notes },
];

function bumpForId(scoreVal: number): number {
  // Convierte 0..100 a 0..200 manteniendo la jerarquía.
  return scoreVal === 0 ? 0 : scoreVal + 100;
}

/**
 * Busca tramos por texto. Devuelve hasta `limit` resultados ordenados por relevancia.
 * Filtra tramos sin geometría utilizable (≥2 coords válidas) para que pulsar
 * un resultado siempre pueda centrar el mapa con bounds seguros.
 */
export function searchSegments(
  segments: Segment[] | null | undefined,
  query: string,
  limit = 12,
): SegmentSearchResult[] {
  const needle = normalizeText(query);
  if (!needle || !segments || segments.length === 0) return [];

  const results: SegmentSearchResult[] = [];

  for (const seg of segments) {
    // Necesita geometría utilizable para poder centrar después.
    if (!Array.isArray(seg.coordinates) || seg.coordinates.length === 0) continue;
    let validCoords = 0;
    for (const c of seg.coordinates) {
      if (isValidLatLng(c)) {
        validCoords++;
        if (validCoords >= 2) break;
      }
    }
    if (validCoords < 2) continue;

    let bestScore = 0;
    let bestField = '';

    // ID fields (peso doble).
    for (const f of ID_FIELDS) {
      const raw = f.get(seg);
      if (raw === undefined || raw === null) continue;
      const norm = normalizeText(raw);
      const s = bumpForId(scoreMatch(norm, needle));
      if (s > bestScore) {
        bestScore = s;
        bestField = f.key;
      }
    }

    // Text fields (peso normal).
    for (const f of TEXT_FIELDS) {
      const raw = f.get(seg);
      if (raw === undefined || raw === null) continue;
      const norm = normalizeText(raw);
      const s = scoreMatch(norm, needle);
      if (s > bestScore) {
        bestScore = s;
        bestField = f.key;
      }
    }

    if (bestScore > 0) {
      results.push({ segment: seg, score: bestScore, matchedField: bestField });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Desempate estable por nombre.
    return (a.segment.name || '').localeCompare(b.segment.name || '');
  });

  return results.slice(0, limit);
}

import type { Segment } from '@/types/route';
import { isValidLatLng } from './coord-validation';

/**
 * Reglas de visibilidad operativas para tramos en el mapa.
 *
 * Estas funciones son la **fuente única** que decide qué tramos deben
 * pintarse y qué tramos cuentan para calcular bounds. Su objetivo es
 * evitar que los componentes de mapa filtren con criterios divergentes
 * (que es lo que causaba que tras crear/borrar tramos el mapa quedara
 * vacío o se centrara en el Golfo de Guinea).
 */

/**
 * Un tramo es visible en el mapa salvo que su capa esté oculta.
 * Tramos sin capa (`undefined` / `null` / `''`) se consideran "Sin capa"
 * y SIEMPRE se pintan — nunca se ocultan por accidente al filtrar capas.
 */
export function isSegmentVisibleOnMap(segment: Segment, hiddenLayers: Set<string>): boolean {
  if (!segment) return false;
  if (segment.layer && hiddenLayers.has(segment.layer)) return false;
  return true;
}

/**
 * Devuelve la lista canónica de tramos que deben pintarse en el mapa,
 * descartando además tramos sin geometría utilizable.
 *
 * Un tramo necesita al menos 2 coordenadas válidas (lat/lng finitas, en
 * rango y distintas de [0,0]) para ser dibujable como polilínea.
 */
export function getVisibleMapSegments(
  segments: Segment[] | undefined | null,
  hiddenLayers: Set<string>,
): Segment[] {
  if (!segments || segments.length === 0) return [];
  const out: Segment[] = [];
  for (const seg of segments) {
    if (!isSegmentVisibleOnMap(seg, hiddenLayers)) continue;
    if (!Array.isArray(seg.coordinates)) continue;
    // Cuenta sólo coordenadas válidas: si <2 no es dibujable
    let validCount = 0;
    for (const c of seg.coordinates) {
      if (isValidLatLng(c)) {
        validCount++;
        if (validCount >= 2) break;
      }
    }
    if (validCount < 2) continue;
    out.push(seg);
  }
  return out;
}

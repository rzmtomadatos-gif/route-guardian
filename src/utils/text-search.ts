/**
 * Utilidades de búsqueda textual para el buscador de mapa.
 *
 * - normalizeText: elimina tildes, pasa a minúsculas, recorta espacios.
 * - scoreMatch: rankea coincidencias por relevancia (exact > prefix > contains).
 * - Trabajo puramente local: no hace fetch.
 */

/** Quita tildes/diacríticos y normaliza a minúsculas para búsquedas tolerantes. */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // NFD descompone "á" → "a" + "´"; \p{Diacritic} elimina los acentos.
  try {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  } catch {
    // Fallback si el motor JS no soporta la propiedad Unicode.
    return s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}

/**
 * Devuelve un score de relevancia para `haystack` contra `needle` ya normalizados.
 * - 100: match exacto
 * - 80: empieza por el texto buscado
 * - 60: contiene el texto buscado en posición temprana
 * - 40: contiene el texto buscado
 * - 0:  no hay match
 */
export function scoreMatch(haystackNorm: string, needleNorm: string): number {
  if (!needleNorm) return 0;
  if (!haystackNorm) return 0;
  if (haystackNorm === needleNorm) return 100;
  if (haystackNorm.startsWith(needleNorm)) return 80;
  const idx = haystackNorm.indexOf(needleNorm);
  if (idx === -1) return 0;
  if (idx <= 3) return 60;
  return 40;
}

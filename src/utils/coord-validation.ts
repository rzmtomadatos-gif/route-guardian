import type { LatLng } from '@/types/route';

/**
 * Validación estricta de una coordenada lat/lng.
 * Evita que coordenadas defectuosas (NaN, undefined, fuera de rango, [0,0])
 * lleguen a fitBounds / extend y arrastren el viewport del mapa al Golfo
 * de Guinea o reventando el render.
 */
export function isValidLatLng(c: { lat: number; lng: number } | null | undefined): c is LatLng {
  if (!c) return false;
  const { lat, lng } = c;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  // Rechazar el sentinel exacto [0,0] (Golfo de Guinea). En España siempre
  // tenemos lat ~ 35..44 y lng ~ -10..4. [0,0] sólo aparece como bug.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Filtra una lista de coordenadas devolviendo sólo las válidas. */
export function filterValidLatLngs<T extends { lat: number; lng: number }>(coords: T[] | null | undefined): T[] {
  if (!coords || coords.length === 0) return [];
  return coords.filter(isValidLatLng);
}

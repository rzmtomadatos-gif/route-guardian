/**
 * Geocoding ligero para el buscador de mapa.
 *
 * - Si Google Maps está cargado en `window.google.maps`, usa `Geocoder` con
 *   `bounds`/`region` para sesgar resultados a la zona de campaña.
 * - Si no, fallback a Nominatim (OSM) con countrycodes=es y viewbox opcional.
 *
 * NOTA: Nominatim público tiene límites de uso (1 req/s aprox.). Aquí sólo
 * disparamos por Enter o tras debounce. TODO si crece el uso: proxy backend
 * o caché.
 */
import type { LatLng } from '@/types/route';

export interface GeoResult {
  label: string;
  /** Subtítulo (provincia, ciudad, tipo) opcional. */
  subtitle?: string;
  location: LatLng;
  /** Bounds opcionales del resultado (si el proveedor los entrega). */
  bounds?: { north: number; south: number; east: number; west: number };
  source: 'google' | 'nominatim';
}

export interface GeocodeOptions {
  /** Sesgo geográfico (centro de la zona de campaña/visible). */
  bias?: {
    center?: LatLng;
    /** Radio aproximado en metros para construir un viewbox. */
    radiusMeters?: number;
  };
  /** Texto extra para sesgar (ej. "Madrid, España"). */
  contextSuffix?: string;
  /** AbortController para cancelar peticiones. */
  signal?: AbortSignal;
  /** Máximo de resultados a devolver. */
  limit?: number;
}

function googleAvailable(): boolean {
  const g = (window as any).google;
  return !!(g && g.maps && g.maps.Geocoder);
}

function metersToDegLat(m: number): number {
  return m / 111_000;
}
function metersToDegLng(m: number, atLat: number): number {
  const cos = Math.cos((atLat * Math.PI) / 180);
  return m / (111_000 * Math.max(0.1, cos));
}

async function geocodeWithGoogle(
  query: string,
  opts: GeocodeOptions,
): Promise<GeoResult[]> {
  const gmaps: any = (window as any).google?.maps;
  if (!gmaps) return [];
  const geocoder = new gmaps.Geocoder();

  const request: any = {
    address: opts.contextSuffix ? `${query}, ${opts.contextSuffix}` : query,
    region: 'es',
  };
  if (opts.bias?.center && opts.bias?.radiusMeters) {
    const c = opts.bias.center;
    const dLat = metersToDegLat(opts.bias.radiusMeters);
    const dLng = metersToDegLng(opts.bias.radiusMeters, c.lat);
    request.bounds = new gmaps.LatLngBounds(
      new gmaps.LatLng(c.lat - dLat, c.lng - dLng),
      new gmaps.LatLng(c.lat + dLat, c.lng + dLng),
    );
  }

  return new Promise<GeoResult[]>((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      resolve([]);
    };
    if (opts.signal) {
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    geocoder.geocode(request, (results: any[], status: string) => {
      if (settled) return;
      settled = true;
      if (status !== 'OK' || !Array.isArray(results)) {
        resolve([]);
        return;
      }
      const limit = Math.max(1, opts.limit ?? 5);
      const out: GeoResult[] = results.slice(0, limit).map((r) => {
        const loc = r.geometry?.location;
        const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
        const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
        const vp = r.geometry?.viewport;
        let bounds: GeoResult['bounds'];
        if (vp) {
          const ne = typeof vp.getNorthEast === 'function' ? vp.getNorthEast() : null;
          const sw = typeof vp.getSouthWest === 'function' ? vp.getSouthWest() : null;
          if (ne && sw) {
            bounds = {
              north: typeof ne.lat === 'function' ? ne.lat() : ne.lat,
              east: typeof ne.lng === 'function' ? ne.lng() : ne.lng,
              south: typeof sw.lat === 'function' ? sw.lat() : sw.lat,
              west: typeof sw.lng === 'function' ? sw.lng() : sw.lng,
            };
          }
        }
        return {
          label: r.formatted_address || query,
          subtitle: r.types?.join(', '),
          location: { lat, lng },
          bounds,
          source: 'google' as const,
        };
      });
      resolve(out.filter((r) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng)));
    });
  });
}

async function geocodeWithNominatim(
  query: string,
  opts: GeocodeOptions,
): Promise<GeoResult[]> {
  const limit = Math.max(1, opts.limit ?? 5);
  const params = new URLSearchParams({
    format: 'json',
    limit: String(limit),
    countrycodes: 'es',
    addressdetails: '1',
    q: opts.contextSuffix ? `${query}, ${opts.contextSuffix}` : query,
  });
  if (opts.bias?.center && opts.bias?.radiusMeters) {
    const c = opts.bias.center;
    const dLat = metersToDegLat(opts.bias.radiusMeters);
    const dLng = metersToDegLng(opts.bias.radiusMeters, c.lat);
    // viewbox = left,top,right,bottom (lon,lat)
    params.set(
      'viewbox',
      `${c.lng - dLng},${c.lat + dLat},${c.lng + dLng},${c.lat - dLat}`,
    );
    params.set('bounded', '1');
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const res = await fetch(url, {
    signal: opts.signal,
    headers: {
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data: any[] = await res.json();
  return (data || []).map((r) => {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    let bounds: GeoResult['bounds'];
    if (Array.isArray(r.boundingbox) && r.boundingbox.length === 4) {
      const [s, n, w, e] = r.boundingbox.map((v: string) => parseFloat(v));
      if ([s, n, w, e].every(Number.isFinite)) {
        bounds = { south: s, north: n, west: w, east: e };
      }
    }
    return {
      label: r.display_name || query,
      subtitle: r.type || r.class,
      location: { lat, lng },
      bounds,
      source: 'nominatim' as const,
    };
  }).filter((r) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng));
}

/**
 * Geocoding combinado. Usa Google si está disponible; si falla o no está, usa Nominatim.
 */
export async function geocodeQuery(
  query: string,
  opts: GeocodeOptions = {},
): Promise<GeoResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (googleAvailable()) {
    try {
      const r = await geocodeWithGoogle(trimmed, opts);
      if (r.length > 0) return r;
    } catch {
      // continuamos al fallback
    }
  }
  return geocodeWithNominatim(trimmed, opts);
}

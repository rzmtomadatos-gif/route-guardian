/**
 * MapSearchBox — buscador flotante en la vista de mapa.
 *
 * Modo "Tramos": búsqueda local sobre `segments` (nombre, id, kmlMeta…),
 * normaliza tildes y prioriza por relevancia. Pulsar un resultado:
 *  - marca el tramo como activo (`onPickSegment`)
 *  - solicita centrar el mapa con bounds seguros
 *  - NO inicia navegación ni cambia estado del tramo.
 *
 * Modo "Mapa": geocoding (Google si está disponible, Nominatim como
 * fallback) sesgado por la zona de campaña / Boadilla del Monte cuando
 * proceda. Pulsar un resultado:
 *  - centra el mapa en la coordenada
 *  - coloca un marcador temporal de búsqueda (gestionado por el padre)
 *  - NO crea tramo automáticamente.
 *
 * El componente es controlado mínimamente: comparte estado del input
 * internamente, pero notifica selecciones al padre vía callbacks.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Search, X, MapPin, Route as RouteIcon, Loader2 } from 'lucide-react';
import type { LatLng, Segment } from '@/types/route';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { searchSegments, type SegmentSearchResult } from '@/utils/segment-search';
import { geocodeQuery, type GeoResult } from '@/utils/geocoding';

type Mode = 'segments' | 'map';

export interface MapSearchPick {
  location: LatLng;
  bounds?: { north: number; south: number; east: number; west: number };
  label: string;
}

interface Props {
  segments: Segment[] | null | undefined;
  /** Sesgo geográfico para geocoding (centro/radio aproximado). */
  bias?: { center?: LatLng | null; radiusMeters?: number };
  /** Sufijo de contexto ("Boadilla del Monte, Madrid, España" si aplica). */
  contextSuffix?: string;
  /** El operador escogió un tramo: marcar activo + pedir centrar. */
  onPickSegment: (segment: Segment) => void;
  /** El operador escogió un lugar: centrar mapa + colocar marcador temporal. */
  onPickLocation: (pick: MapSearchPick) => void;
  /** Limpiar marcador temporal de búsqueda. */
  onClearLocation?: () => void;
}

export function MapSearchBox({
  segments,
  bias,
  contextSuffix,
  onPickSegment,
  onPickLocation,
  onClearLocation,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('segments');
  const [geoResults, setGeoResults] = useState<GeoResult[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const geoAbortRef = useRef<AbortController | null>(null);
  const geoDebounceRef = useRef<number | null>(null);

  // --- Resultados locales (tramos) — inmediatos, sin debounce ---
  const segmentResults: SegmentSearchResult[] = useMemo(() => {
    if (mode !== 'segments') return [];
    return searchSegments(segments ?? [], query, 12);
  }, [segments, query, mode]);

  // --- Resultados de geocoding (mapa) — con debounce ---
  const launchGeocoding = useCallback(
    (q: string) => {
      geoAbortRef.current?.abort();
      const ctrl = new AbortController();
      geoAbortRef.current = ctrl;
      setGeoLoading(true);
      setGeoError(null);
      geocodeQuery(q, {
        signal: ctrl.signal,
        contextSuffix,
        bias: bias?.center
          ? { center: bias.center, radiusMeters: bias.radiusMeters ?? 5000 }
          : undefined,
        limit: 5,
      })
        .then((results) => {
          if (ctrl.signal.aborted) return;
          setGeoResults(results);
          if (results.length === 0) setGeoError('Sin resultados');
        })
        .catch((err) => {
          if (ctrl.signal.aborted) return;
          setGeoError(err instanceof Error ? err.message : 'Error consultando');
          setGeoResults([]);
        })
        .finally(() => {
          if (geoAbortRef.current === ctrl) geoAbortRef.current = null;
          setGeoLoading(false);
        });
    },
    [bias, contextSuffix],
  );

  useEffect(() => {
    if (mode !== 'map') return;
    if (geoDebounceRef.current) window.clearTimeout(geoDebounceRef.current);
    if (!query.trim()) {
      setGeoResults([]);
      setGeoError(null);
      setGeoLoading(false);
      return;
    }
    geoDebounceRef.current = window.setTimeout(() => {
      launchGeocoding(query.trim());
    }, 500);
    return () => {
      if (geoDebounceRef.current) window.clearTimeout(geoDebounceRef.current);
    };
  }, [query, mode, launchGeocoding]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geoAbortRef.current?.abort();
      if (geoDebounceRef.current) window.clearTimeout(geoDebounceRef.current);
    };
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    setGeoResults([]);
    setGeoError(null);
    onClearLocation?.();
    inputRef.current?.focus();
  }, [onClearLocation]);

  const handlePickSegment = useCallback(
    (seg: Segment) => {
      onPickSegment(seg);
      setOpen(false);
    },
    [onPickSegment],
  );

  const handlePickLocation = useCallback(
    (r: GeoResult) => {
      onPickLocation({ location: r.location, bounds: r.bounds, label: r.label });
      setOpen(false);
    },
    [onPickLocation],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'segments' && segmentResults.length > 0) {
        handlePickSegment(segmentResults[0].segment);
        return;
      }
      if (mode === 'map') {
        if (geoResults.length > 0) {
          handlePickLocation(geoResults[0]);
        } else if (query.trim()) {
          launchGeocoding(query.trim());
        }
        return;
      }
      // Si estamos en "Tramos" sin resultados, escala a búsqueda en mapa.
      if (mode === 'segments' && segmentResults.length === 0 && query.trim()) {
        setMode('map');
        launchGeocoding(query.trim());
      }
    }
  };

  const showResults = open && query.trim().length > 0;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[min(420px,calc(100%-1.5rem))]">
      <div className="bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar tramo o calle…"
            className="h-8 border-0 bg-transparent px-1 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {query && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={handleClear}
              title="Limpiar búsqueda"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        {showResults && (
          <div className="border-t border-border">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
              <TabsList className="grid grid-cols-2 mx-2 mt-2 h-8">
                <TabsTrigger value="segments" className="text-xs h-6">
                  <RouteIcon className="w-3 h-3 mr-1" />
                  Tramos
                  {segmentResults.length > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {segmentResults.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="map" className="text-xs h-6">
                  <MapPin className="w-3 h-3 mr-1" />
                  Mapa
                </TabsTrigger>
              </TabsList>

              <div className="max-h-[320px] overflow-y-auto py-1">
                {mode === 'segments' && (
                  <SegmentResultsList
                    results={segmentResults}
                    onPick={handlePickSegment}
                    onSwitchToMap={() => {
                      setMode('map');
                      if (query.trim()) launchGeocoding(query.trim());
                    }}
                    query={query}
                  />
                )}
                {mode === 'map' && (
                  <MapResultsList
                    results={geoResults}
                    loading={geoLoading}
                    error={geoError}
                    onPick={handlePickLocation}
                  />
                )}
              </div>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Subcomponentes de resultados ---

function SegmentResultsList({
  results,
  onPick,
  onSwitchToMap,
  query,
}: {
  results: SegmentSearchResult[];
  onPick: (s: Segment) => void;
  onSwitchToMap: () => void;
  query: string;
}) {
  if (results.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground space-y-2">
        <p>Sin tramos coincidentes.</p>
        {query.trim() && (
          <button
            type="button"
            onClick={onSwitchToMap}
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            <MapPin className="w-3 h-3" />
            Buscar “{query.trim()}” en mapa
          </button>
        )}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/50">
      {results.map((r) => {
        const seg = r.segment;
        const ref = seg.kmlMeta?.ref || seg.kmlMeta?.carretera;
        const idLabel = seg.companySegmentId || seg.kmlId || seg.id;
        return (
          <li key={seg.id}>
            <button
              type="button"
              onClick={() => onPick(seg)}
              className="w-full text-left px-3 py-2 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">
                    {seg.name || '(sin nombre)'}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[seg.layer, ref, statusLabel(seg.status)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground/70 font-mono shrink-0 mt-0.5">
                  {idLabel}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MapResultsList({
  results,
  loading,
  error,
  onPick,
}: {
  results: GeoResult[];
  loading: boolean;
  error: string | null;
  onPick: (r: GeoResult) => void;
}) {
  if (loading) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Buscando…
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        {error ? error : 'Escribe un nombre de calle o lugar…'}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/50">
      {results.map((r, i) => (
        <li key={`${r.label}-${i}`}>
          <button
            type="button"
            onClick={() => onPick(r)}
            className="w-full text-left px-3 py-2 hover:bg-accent/40 active:bg-accent/60 transition-colors"
          >
            <div className="text-sm text-foreground line-clamp-2">{r.label}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {r.source === 'google' ? 'Google' : 'OpenStreetMap'}
              {r.subtitle ? ` · ${r.subtitle}` : ''}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function statusLabel(status: Segment['status']): string {
  switch (status) {
    case 'pendiente':
      return 'pendiente';
    case 'en_progreso':
      return 'en progreso';
    case 'completado':
      return 'completado';
    case 'posible_repetir':
      return 'repetir';
    default:
      return status;
  }
}

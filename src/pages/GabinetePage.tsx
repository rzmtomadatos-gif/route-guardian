/**
 * Página /gabinete — vertical slice usable del modo gabinete.
 *
 * Solo accesible para roles `admin` y `gabinete` (defensa en profundidad:
 * tab oculta en AppLayout + comprobación al montar).
 *
 * Contiene dos sub-vistas:
 *  - "Tramos": tabla principal de tramos con correcciones (existente).
 *  - "Tracks GPS": resumen por día/track de la traza GPS real (Fase 1 GPS).
 */

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, ShieldOff, ClipboardEdit, Map as MapIcon, List } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';
import { useSegmentCorrections } from '@/hooks/useSegmentCorrections';
import type { AppState, Segment, SegmentStatus } from '@/types/route';
import { GabineteSegmentsTable } from '@/components/gabinete/GabineteSegmentsTable';
import { GabineteSegmentDetailDialog } from '@/components/gabinete/GabineteSegmentDetailDialog';
import { GpsTracksTable } from '@/components/gabinete/GpsTracksTable';
import { GpsTrackDetailDialog } from '@/components/gabinete/GpsTrackDetailDialog';
import {
  getTrackPoints,
  listAvailableDays,
} from '@/utils/gabinete/track-gps-derived';

interface Props {
  state: AppState;
}

const STATUS_FILTERS: { value: 'all' | SegmentStatus; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completado', label: 'Completado' },
  { value: 'posible_repetir', label: 'Posible repetir' },
];

export default function GabinetePage({ state }: Props) {
  const { role, loading: roleLoading, canViewGabinete } = useUserRole();
  const { getConsolidatedSegment } = useSegmentCorrections();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SegmentStatus>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [trackFilter, setTrackFilter] = useState<string>('all');
  const [openSegment, setOpenSegment] = useState<Segment | null>(null);

  // ----- GPS sub-view state -----
  const gpsLogs = state.trackGpsLogsByDay ?? {};
  const gpsDays = useMemo(() => listAvailableDays(gpsLogs), [gpsLogs]);
  const [gpsDay, setGpsDay] = useState<number | null>(null);
  const effectiveGpsDay = gpsDay ?? gpsDays[0] ?? null;
  const [openGpsTrack, setOpenGpsTrack] = useState<{ day: number; track: number } | null>(null);

  const allSegments = state.route?.segments ?? [];

  // Listas únicas de días y tracks (desde valores consolidados)
  const { days, tracks } = useMemo(() => {
    const dSet = new Set<number>();
    const tSet = new Set<number>();
    allSegments.forEach((s) => {
      const c = getConsolidatedSegment(s);
      if (typeof c.workDay === 'number') dSet.add(c.workDay);
      if (typeof c.trackNumber === 'number') tSet.add(c.trackNumber);
    });
    return {
      days: Array.from(dSet).sort((a, b) => a - b),
      tracks: Array.from(tSet).sort((a, b) => a - b),
    };
  }, [allSegments, getConsolidatedSegment]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSegments.filter((s) => {
      const c = getConsolidatedSegment(s);
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (dayFilter !== 'all' && String(c.workDay ?? '') !== dayFilter) return false;
      if (trackFilter !== 'all' && String(c.trackNumber ?? '') !== trackFilter) return false;
      if (q) {
        const haystack = [
          c.name,
          c.companySegmentId,
          c.kmlId,
          c.kmlMeta?.carretera,
          c.kmlMeta?.identtramo,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allSegments, search, statusFilter, dayFilter, trackFilter, getConsolidatedSegment]);

  const openGpsPoints = useMemo(() => {
    if (!openGpsTrack) return [];
    return getTrackPoints(gpsLogs, openGpsTrack.day, openGpsTrack.track);
  }, [gpsLogs, openGpsTrack]);

  // Defensa en profundidad: ocultar contenido si el rol no es válido.
  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canViewGabinete) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
        <ShieldOff className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">Acceso restringido</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          El modo gabinete solo está disponible para perfiles administrativos
          ({role ? `tu rol actual: ${role}` : 'sin rol asignado'}).
        </p>
      </div>
    );
  }

  if (!state.route) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
        <ClipboardEdit className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">Sin campaña cargada</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Carga una campaña desde la pestaña "Cargar" para revisar y corregir
          tramos en modo gabinete.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <ClipboardEdit className="w-5 h-5 text-primary" />
            Modo Gabinete
          </h1>
          <p className="text-xs text-muted-foreground">
            {allSegments.length} tramo{allSegments.length === 1 ? '' : 's'} en la campaña
          </p>
        </div>
      </div>

      <Tabs defaultValue="segments" className="w-full">
        <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid">
          <TabsTrigger value="segments" className="text-xs gap-1.5">
            <List className="w-3.5 h-3.5" />
            Tramos
          </TabsTrigger>
          <TabsTrigger value="gps" className="text-xs gap-1.5">
            <MapIcon className="w-3.5 h-3.5" />
            Tracks GPS
            {gpsDays.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({gpsDays.length}d)
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ---------- Sub-vista TRAMOS ---------- */}
        <TabsContent value="segments" className="space-y-3 mt-3">
          <p className="text-[11px] text-muted-foreground">
            {filtered.length !== allSegments.length
              ? `${filtered.length} tras filtros`
              : `${allSegments.length} tramos`}
          </p>

          {/* Filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nombre, ID, carretera…"
                className="pl-7 h-9 text-sm"
              />
            </div>

            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | SegmentStatus)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={dayFilter} onValueChange={setDayFilter}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los días</SelectItem>
                {days.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    Día {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={trackFilter} onValueChange={setTrackFilter}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tracks</SelectItem>
                {tracks.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    Track {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <GabineteSegmentsTable
            segments={filtered}
            onOpen={(s) => setOpenSegment(s)}
          />
        </TabsContent>

        {/* ---------- Sub-vista TRACKS GPS ---------- */}
        <TabsContent value="gps" className="space-y-3 mt-3">
          {gpsDays.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 py-12 text-center text-xs text-muted-foreground">
              No hay puntos GPS registrados aún. La traza se captura automáticamente
              durante la navegación con un track activo.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Día:</span>
                <Select
                  value={String(effectiveGpsDay ?? '')}
                  onValueChange={(v) => setGpsDay(Number(v))}
                >
                  <SelectTrigger className="h-9 text-sm w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gpsDays.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        Día {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {effectiveGpsDay !== null && (
                <GpsTracksTable
                  day={effectiveGpsDay}
                  logsByDay={gpsLogs}
                  onOpen={(d, t) => setOpenGpsTrack({ day: d, track: t })}
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <GabineteSegmentDetailDialog
        open={openSegment !== null}
        segment={openSegment}
        onClose={() => setOpenSegment(null)}
      />

      <GpsTrackDetailDialog
        open={openGpsTrack !== null}
        day={openGpsTrack?.day ?? null}
        track={openGpsTrack?.track ?? null}
        points={openGpsPoints}
        allSegments={allSegments}
        onClose={() => setOpenGpsTrack(null)}
      />
    </div>
  );
}

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Trash2, HardDrive, Map, Wifi, WifiOff, CheckCircle, Download, Database, MapPin, AlertTriangle, ChevronDown } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  listOfflineTileSources,
  addOfflineTileSource,
  removeOfflineTileSource,
  getActiveOfflineMapId,
  setActiveOfflineMapId,
  getOfflineMapMode,
  setOfflineMapMode,
  getTileCacheInfo,
  clearTileCache,
  REGION_CATALOG,
  getExtractCommand,
  type OfflineTileSource,
  type OfflineMapMode,
  type TileCacheInfo,
} from '@/utils/offline-tiles';
import { computeCoverageScore } from '@/hooks/useMapState';
import { useConnectivity } from '@/hooks/useConnectivity';
import { toast } from 'sonner';
import type { Segment } from '@/types/route';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Coverage description for operators */
function coverageLabel(score: number): { text: string; class: string } {
  if (score >= 0.8) return { text: 'Cubre tu campaña', class: 'text-green-400' };
  if (score >= 0.5) return { text: 'Cobertura parcial', class: 'text-amber-400' };
  if (score > 0) return { text: 'Cobertura limitada', class: 'text-orange-400' };
  return { text: 'No cubre esta zona', class: 'text-red-400' };
}

interface Props {
  /** Campaign segments for coverage analysis */
  segments?: Segment[];
  /** Active segment for priority coverage */
  activeSegment?: Segment | null;
}

export function OfflineMapsManager({ segments = [], activeSegment }: Props) {
  const [sources, setSources] = useState<OfflineTileSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveIdState] = useState<string | null>(() => getActiveOfflineMapId());
  const [mode, setModeState] = useState<OfflineMapMode>(() => getOfflineMapMode());
  const [cacheInfo, setCacheInfo] = useState<TileCacheInfo | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const { isOnline } = useConnectivity();
  const fileRef = useRef<HTMLInputElement>(null);

  const [hasSW, setHasSW] = useState(false);

  useEffect(() => {
    listOfflineTileSources().then(setSources).catch(() => {});
    getTileCacheInfo().then(setCacheInfo).catch(() => {});
    // Check if Service Worker is registered
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => setHasSW(!!reg));
    }
    // Refresh cache info every 30s
    const interval = setInterval(() => {
      getTileCacheInfo().then(setCacheInfo).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Compute coverage scores for each source
  const sourcesWithCoverage = useMemo(() => {
    return sources.map(s => ({
      source: s,
      score: computeCoverageScore(s, segments, activeSegment),
    }));
  }, [sources, segments, activeSegment]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pmtiles')) {
      toast.error('Formato no soportado. Selecciona un archivo de mapa (.pmtiles)');
      return;
    }
    setLoading(true);
    try {
      const source = await addOfflineTileSource(file, file.name.replace('.pmtiles', ''));
      setSources((prev) => [...prev, source]);
      if (sources.length === 0) {
        setActiveIdState(source.id);
        setActiveOfflineMapId(source.id);
      }
      toast.success(`Mapa "${source.name}" añadido (${formatBytes(source.size)})`);
    } catch (err: any) {
      toast.error(err.message || 'Error importando el mapa');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await removeOfflineTileSource(id);
      setSources((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveIdState(null);
        setActiveOfflineMapId(null);
      }
      toast.success(`Mapa "${name}" eliminado`);
    } catch (err: any) {
      toast.error(`Error eliminando: ${err.message || err}`);
    }
  };

  const handleActivate = (id: string | null) => {
    setActiveIdState(id);
    setActiveOfflineMapId(id);
    toast.success(id ? 'Mapa activado para uso sin conexión' : 'Mapa desactivado');
  };

  const handleModeToggle = () => {
    const next: OfflineMapMode = mode === 'auto' ? 'offline' : 'auto';
    setModeState(next);
    setOfflineMapMode(next);
    toast.info(next === 'auto'
      ? 'Modo automático: mapa online con red, offline sin red'
      : 'Modo forzado: siempre usa el mapa descargado');
  };

  const handleClearCache = async () => {
    await clearTileCache();
    setCacheInfo({ tileCount: 0 });
    toast.success('Caché limpiada');
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Map className="w-4 h-4" />
        <span className="text-sm font-medium">Mapas sin conexión</span>
        <span className={`ml-auto flex items-center gap-1 text-[10px] ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isOnline ? 'Con red' : 'Sin red'}
        </span>
      </div>

      <div className="bg-card rounded-xl p-4 border border-border space-y-4">
        {/* Explanation for operators */}
        {sources.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-5 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <HardDrive className="w-6 h-6 text-primary/60" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Navega sin cobertura de red
              </p>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                Añade un mapa de tu zona de trabajo para ver carreteras y tramos
                cuando no haya conexión a internet.
              </p>
            </div>
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="mt-1"
            >
              <Upload className="w-4 h-4 mr-2" />
              {loading ? 'Importando...' : 'Añadir mapa de zona'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".pmtiles"
              className="hidden"
              onChange={handleImport}
            />
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center gap-1"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
              ¿Cómo obtener el archivo?
            </button>
            {showTechnical && <TechnicalInstructions />}
          </div>
        )}

        {/* Maps list */}
        {sources.length > 0 && (
          <>
            {/* Mode toggle */}
            {activeId && (
              <button
                onClick={handleModeToggle}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                  mode === 'offline'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-border bg-secondary/50 text-muted-foreground'
                }`}
              >
                <span className="flex items-center gap-2">
                  {mode === 'auto' ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-400" />
                      Automático: online con red, offline sin red
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-400" />
                      Siempre usar mapa descargado
                    </>
                  )}
                </span>
                <span className="text-[10px] opacity-60">cambiar</span>
              </button>
            )}

            {/* Source cards */}
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Mapas disponibles ({sources.length})
              </p>
              {sourcesWithCoverage.map(({ source: s, score }) => {
                const isActive = activeId === s.id;
                const coverage = coverageLabel(score);
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      isActive
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-secondary/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isActive && <CheckCircle className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                          <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                        </div>
                        <div className="mt-1 space-y-0.5">
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(s.size)} · Añadido {formatDate(s.addedAt)}
                          </p>
                          {/* Coverage indicator — only when campaign is loaded */}
                          {segments.length > 0 && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              <span className={`text-[11px] font-medium ${coverage.class}`}>
                                {coverage.text}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                        <Button
                          size="sm"
                          variant={isActive ? 'default' : 'outline'}
                          className="h-7 text-xs px-3"
                          onClick={() => handleActivate(isActive ? null : s.id)}
                        >
                          {isActive ? 'Activo' : 'Usar este'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(s.id, s.name)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {/* Coverage warning */}
                    {isActive && segments.length > 0 && score < 0.5 && (
                      <div className="mt-2 flex items-start gap-1.5 bg-orange-500/10 rounded px-2.5 py-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-orange-300">
                          Este mapa no cubre bien tu campaña actual. Si tienes otro mapa de esta zona, actívalo.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add another map */}
            <div className="space-y-1">
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                {loading ? 'Importando...' : 'Añadir otro mapa'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".pmtiles"
                className="hidden"
                onChange={handleImport}
              />
              <button
                onClick={() => setShowTechnical(!showTechnical)}
                className="w-full text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors flex items-center justify-center gap-1 py-1"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
                ¿Cómo obtener un mapa?
              </button>
              {showTechnical && <TechnicalInstructions />}
            </div>
          </>
        )}

        {/* Cache section — clearly differentiated */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Caché automática
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
            Guarda temporalmente las zonas que has visitado con conexión.
            Mejora la rapidez, pero <strong className="text-muted-foreground">no sustituye a un mapa descargado</strong>.
          </p>

          {!hasSW ? (
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-xs text-muted-foreground">
                La caché de teselas solo funciona en la <strong className="text-foreground">app instalada (PWA)</strong>.
                En el navegador normal no se guardan teselas para uso offline.
              </p>
            </div>
          ) : cacheInfo !== null ? (
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {cacheInfo.tileCount.toLocaleString('es-ES')} zonas guardadas
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Se borran automáticamente en 7 días (máx. 5.000)
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => getTileCacheInfo().then(setCacheInfo).catch(() => {})}
                  >
                    ↻
                  </Button>
                  {cacheInfo.tileCount > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive/70 hover:text-destructive"
                      onClick={handleClearCache}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>
              {cacheInfo.tileCount > 0 && (
                <div className="mt-2">
                  <Progress value={Math.min((cacheInfo.tileCount / 5000) * 100, 100)} className="h-1.5" />
                </div>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/70">
              Caché no disponible en este navegador
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Technical instructions — collapsed by default, not the main path */
function TechnicalInstructions() {
  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      toast.success('Comando copiado');
    }).catch(() => {
      toast.error('No se pudo copiar');
    });
  };

  return (
    <div className="w-full mt-2 space-y-3 text-left">
      <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
        <p className="text-[11px] font-medium text-foreground">Obtener un mapa regional</p>
        <ol className="list-decimal list-inside text-[11px] text-muted-foreground space-y-1.5">
          <li>
            Descarga la herramienta{' '}
            <a
              href="https://github.com/protomaps/go-pmtiles/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              pmtiles CLI
            </a>
          </li>
          <li>Ejecuta el comando de extracción de tu zona</li>
          <li>Importa el archivo generado aquí</li>
        </ol>

        <p className="text-[10px] font-medium text-muted-foreground mt-3 uppercase tracking-wide">
          Comandos rápidos por país
        </p>
        <div className="space-y-1.5">
          {REGION_CATALOG.map((region) => {
            const cmd = getExtractCommand(region);
            return (
              <div key={region.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-[11px] text-foreground">
                  {region.flag} {region.name} <span className="text-muted-foreground">({region.approxSize})</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] px-2"
                  onClick={() => handleCopy(cmd)}
                >
                  Copiar cmd
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

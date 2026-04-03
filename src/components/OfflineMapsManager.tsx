import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Upload, Trash2, HardDrive, Map, Wifi, WifiOff, CheckCircle, ExternalLink, Info } from 'lucide-react';
import {
  listOfflineTileSources,
  addOfflineTileSource,
  removeOfflineTileSource,
  getActiveOfflineMapId,
  setActiveOfflineMapId,
  getOfflineMapMode,
  setOfflineMapMode,
  type OfflineTileSource,
  type OfflineMapMode,
} from '@/utils/offline-tiles';
import { useConnectivity } from '@/hooks/useConnectivity';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatBounds(bounds: [number, number, number, number]): string {
  const [w, s, e, n] = bounds;
  if (w <= -179 && s <= -89 && e >= 179 && n >= 89) return 'Cobertura global';
  return `${s.toFixed(1)}°–${n.toFixed(1)}°N, ${w.toFixed(1)}°–${e.toFixed(1)}°E`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export function OfflineMapsManager() {
  const [sources, setSources] = useState<OfflineTileSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveIdState] = useState<string | null>(() => getActiveOfflineMapId());
  const [mode, setModeState] = useState<OfflineMapMode>(() => getOfflineMapMode());
  const { isOnline } = useConnectivity();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listOfflineTileSources().then(setSources).catch(() => {});
  }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pmtiles')) {
      toast.error('Formato no soportado. Usa archivos .pmtiles');
      return;
    }
    setLoading(true);
    try {
      const source = await addOfflineTileSource(file, file.name.replace('.pmtiles', ''));
      setSources((prev) => [...prev, source]);
      // Auto-activate if it's the only one
      if (sources.length === 0) {
        setActiveIdState(source.id);
        setActiveOfflineMapId(source.id);
      }
      toast.success(`Mapa "${source.name}" importado (${formatBytes(source.size)})`);
    } catch (err: any) {
      toast.error(`Error importando: ${err.message || err}`);
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
    toast.success(id ? 'Mapa offline activado' : 'Mapa offline desactivado');
  };

  const handleModeToggle = () => {
    const next: OfflineMapMode = mode === 'auto' ? 'offline' : 'auto';
    setModeState(next);
    setOfflineMapMode(next);
    toast.info(next === 'auto'
      ? 'Modo automático: online con red, offline sin red'
      : 'Modo forzado: siempre usa mapa offline');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Map className="w-4 h-4" />
        <span className="text-sm font-medium">Mapas sin conexión</span>
        <span className={`ml-auto flex items-center gap-1 text-[10px] ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isOnline ? 'Online' : 'Sin red'}
        </span>
      </div>

      <div className="bg-card rounded-xl p-4 border border-border space-y-4">
        {/* Explanation */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Descarga un mapa de tu zona de trabajo para usarlo sin conexión a internet.
            El mapa se activa automáticamente cuando no hay red disponible.
          </p>
        </div>

        {/* Mode toggle - only show if there's an active map */}
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
                  Forzado: siempre usa mapa offline
                </>
              )}
            </span>
            <span className="text-[10px] opacity-60">cambiar</span>
          </button>
        )}

        {/* Downloaded maps list */}
        {sources.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Mapas descargados ({sources.length})
            </p>
            {sources.map((s) => {
              const isActive = activeId === s.id;
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
                          {formatBytes(s.size)} · {formatBounds(s.bounds)}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70">
                          Importado: {formatDate(s.addedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                      <Button
                        size="sm"
                        variant={isActive ? 'default' : 'outline'}
                        className="h-7 text-xs px-3"
                        onClick={() => handleActivate(isActive ? null : s.id)}
                      >
                        {isActive ? 'Activo' : 'Usar'}
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
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <HardDrive className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              No hay mapas descargados
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              Importa un mapa para poder navegar sin conexión
            </p>
          </div>
        )}

        {/* Import button */}
        <div className="space-y-2">
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <Upload className="w-4 h-4 mr-2" />
            {loading ? 'Importando mapa...' : 'Importar mapa offline'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pmtiles"
            className="hidden"
            onChange={handleImport}
          />
        </div>

        {/* How to download guide */}
        <details className="group">
          <summary className="flex items-center gap-1.5 text-[11px] text-primary cursor-pointer hover:underline">
            <Info className="w-3 h-3" />
            ¿Cómo descargar un mapa de tu zona?
          </summary>
          <div className="mt-2 pl-4 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
            <ol className="list-decimal list-inside space-y-1.5">
              <li>
                Ve a{' '}
                <a
                  href="https://protomaps.com/downloads"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  protomaps.com/downloads <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </li>
              <li>Selecciona la región o país que necesitas</li>
              <li>Descarga el archivo <code className="text-foreground bg-secondary px-1 rounded">.pmtiles</code></li>
              <li>Vuelve aquí y pulsa "Importar mapa offline"</li>
            </ol>
            <p className="text-[10px] text-muted-foreground/70 mt-2">
              💡 Para España entera (~500 MB), usa extracto de la península ibérica.
              Para zonas pequeñas hay extractos provinciales más ligeros.
            </p>
          </div>
        </details>

        {/* Cache vs offline real explanation */}
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            ¿Qué diferencia hay?
          </p>
          <div className="grid grid-cols-1 gap-2">
            <div className="flex gap-2 items-start">
              <span className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
              <div>
                <p className="text-[11px] text-foreground font-medium">Mapa offline descargado</p>
                <p className="text-[10px] text-muted-foreground">
                  Cobertura completa de una región. Funciona sin conexión garantizada.
                </p>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 mt-1.5 flex-shrink-0" />
              <div>
                <p className="text-[11px] text-foreground font-medium">Caché de zonas visitadas</p>
                <p className="text-[10px] text-muted-foreground">
                  Solo guarda zonas ya vistas online (máx. 2000 tiles, 7 días). 
                  Acelera la carga pero NO garantiza cobertura sin conexión.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

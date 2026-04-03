import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Upload, Trash2, HardDrive, Map, Wifi, WifiOff } from 'lucide-react';
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
  if (w <= -179 && s <= -89 && e >= 179 && n >= 89) return 'Global (sin bounds específicos)';
  return `${s.toFixed(2)}°–${n.toFixed(2)}°N, ${w.toFixed(2)}°–${e.toFixed(2)}°E`;
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
      toast.error('Solo se aceptan archivos .pmtiles');
      return;
    }
    setLoading(true);
    try {
      const source = await addOfflineTileSource(file, file.name.replace('.pmtiles', ''));
      setSources((prev) => [...prev, source]);
      const boundsInfo = formatBounds(source.bounds);
      toast.success(`Mapa offline "${source.name}" importado (${formatBytes(source.size)}) — ${boundsInfo}`);
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
      toast.success(`Mapa offline "${name}" eliminado`);
    } catch (err: any) {
      toast.error(`Error eliminando: ${err.message || err}`);
    }
  };

  const handleActivate = (id: string | null) => {
    setActiveIdState(id);
    setActiveOfflineMapId(id);
    toast.success(id ? 'Mapa offline seleccionado' : 'Mapa offline desactivado');
  };

  const handleModeToggle = () => {
    const next: OfflineMapMode = mode === 'auto' ? 'offline' : 'auto';
    setModeState(next);
    setOfflineMapMode(next);
    toast.info(next === 'auto'
      ? 'Modo auto: mapa online con red, offline sin red'
      : 'Modo forzado: siempre usa mapa offline seleccionado');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Map className="w-4 h-4" />
        <span className="text-sm font-medium">Mapas offline</span>
        <span className={`ml-auto flex items-center gap-1 text-[10px] ${isOnline ? 'text-green-400' : 'text-amber-400'}`}>
          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="bg-card rounded-xl p-4 border border-border space-y-3">
        <p className="text-xs text-muted-foreground">
          Importa archivos <code className="text-foreground">.pmtiles</code> para cartografía sin conexión.
          Descarga extractos regionales desde{' '}
          <a
            href="https://protomaps.com/downloads"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            protomaps.com
          </a>.
        </p>

        {/* Mode toggle */}
        {activeId && (
          <button
            onClick={handleModeToggle}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${
              mode === 'offline'
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-border bg-secondary/50 text-muted-foreground'
            }`}
          >
            <span>{mode === 'auto' ? '🔄 Auto: online si hay red, offline si no' : '📴 Forzado: siempre offline'}</span>
            <span className="text-[10px] opacity-60">toca para cambiar</span>
          </button>
        )}

        {sources.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <MapPin className="w-4 h-4" />
            No hay mapas offline almacenados
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div
                key={s.id}
                className={`flex items-center justify-between p-2 rounded-lg border text-sm ${
                  activeId === s.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <HardDrive className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatBytes(s.size)} · {formatBounds(s.bounds)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="sm"
                    variant={activeId === s.id ? 'default' : 'outline'}
                    className="h-7 text-xs px-2"
                    onClick={() => handleActivate(activeId === s.id ? null : s.id)}
                  >
                    {activeId === s.id ? 'Activo' : 'Usar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(s.id, s.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          variant="outline"
          size="sm"
          className="w-full"
        >
          <Upload className="w-4 h-4 mr-2" />
          {loading ? 'Importando...' : 'Importar mapa .pmtiles'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".pmtiles"
          className="hidden"
          onChange={handleImport}
        />

        <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1">
          <p>
            <strong>Mapa offline real</strong> = archivo PMTiles importado con cobertura completa de una región.
          </p>
          <p>
            <strong>Caché de tiles</strong> = tiles visitados previamente online que se guardan automáticamente
            (hasta 2000 tiles, 7 días). No sustituye a un mapa offline real.
          </p>
        </div>
      </div>
    </div>
  );
}

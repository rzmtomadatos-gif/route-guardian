import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { MapPin, Upload, Trash2, HardDrive, Map } from 'lucide-react';
import {
  listOfflineTileSources,
  addOfflineTileSource,
  removeOfflineTileSource,
  type OfflineTileSource,
} from '@/utils/offline-tiles';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function OfflineMapsManager() {
  const [sources, setSources] = useState<OfflineTileSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem('vialroute_active_offline_map'); } catch { return null; }
  });
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
      // For now, use a default bounding box — in a real implementation,
      // we'd read the PMTiles header to extract bounds
      const source = await addOfflineTileSource(
        file,
        file.name.replace('.pmtiles', ''),
        [-180, -90, 180, 90], // placeholder bounds
      );
      setSources((prev) => [...prev, source]);
      toast.success(`Mapa offline "${source.name}" importado (${formatBytes(source.size)})`);
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
        setActiveId(null);
        try { localStorage.removeItem('vialroute_active_offline_map'); } catch {}
      }
      toast.success(`Mapa offline "${name}" eliminado`);
    } catch (err: any) {
      toast.error(`Error eliminando: ${err.message || err}`);
    }
  };

  const handleActivate = (id: string | null) => {
    setActiveId(id);
    try {
      if (id) localStorage.setItem('vialroute_active_offline_map', id);
      else localStorage.removeItem('vialroute_active_offline_map');
    } catch {}
    toast.success(id ? 'Mapa offline activado' : 'Mapa online restaurado');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Map className="w-4 h-4" />
        <span className="text-sm font-medium">Mapas offline</span>
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
                    <p className="text-[10px] text-muted-foreground">{formatBytes(s.size)}</p>
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

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <strong>Nota:</strong> Los tiles visitados previamente online también se guardan en caché automáticamente (hasta 2000 tiles, 7 días).
          Un mapa PMTiles importado ofrece cobertura completa de la región sin depender de visitas previas.
        </p>
      </div>
    </div>
  );
}

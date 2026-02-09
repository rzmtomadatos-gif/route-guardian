import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Route, AlertCircle, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseKMLFile } from '@/utils/kml-parser';
import { generateSampleRoute } from '@/utils/sample-kml';
import type { Route as RouteType } from '@/types/route';

interface Props {
  onRouteLoaded: (route: RouteType) => void;
  hasRoute: boolean;
}

function UploadPage({ onRouteLoaded, hasRoute }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext !== 'kml' && ext !== 'kmz') {
        setError('Solo se aceptan archivos KML o KMZ');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const route = await parseKMLFile(file);
        onRouteLoaded(route);
        navigate('/map');
      } catch (e: any) {
        setError(e.message || 'Error al procesar el archivo');
      } finally {
        setLoading(false);
      }
    },
    [onRouteLoaded, navigate]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-2">
            <Route className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">VialRoute</h1>
          <p className="text-muted-foreground text-sm">
            Carga un archivo KML/KMZ con los tramos a grabar para generar la ruta optimizada.
          </p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`relative flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          }`}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".kml,.kmz"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Procesando archivo...</span>
            </div>
          ) : (
            <>
              <FileUp className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground">
                Arrastra un archivo o toca para seleccionar
              </p>
              <p className="text-xs text-muted-foreground mt-1">KML / KMZ</p>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <Button
          onClick={() => {
            const sample = generateSampleRoute();
            onRouteLoaded(sample);
            navigate('/map');
          }}
          variant="outline"
          className="w-full driving-button border-border text-foreground"
        >
          <MapPin className="w-4 h-4 mr-2" />
          Cargar ruta de ejemplo
        </Button>

        {hasRoute && (
          <Button
            onClick={() => navigate('/map')}
            variant="outline"
            className="w-full driving-button border-border text-foreground"
          >
            Ver ruta cargada
          </Button>
        )}
      </div>
    </div>
  );
}

export default UploadPage;

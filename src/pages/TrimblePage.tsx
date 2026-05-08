/**
 * Página /trimble — vista de campo del modo TRIMBLE_LIDAR.
 *
 * No comparte UI con el flujo RST/Garmin: vive en su propia ruta para no
 * contaminar MapPage. El selector de modo está en /settings.
 */
import { TrimbleFieldPanel } from '@/components/trimble/TrimbleFieldPanel';
import { useRouteStateContext } from '@/context/RouteStateContext';
import { Radar } from 'lucide-react';

export default function TrimblePage() {
  const { state } = useRouteStateContext();
  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 bg-card border-b border-border">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Radar className="w-5 h-5 text-primary" />
          Trimble LiDAR
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Cuaderno de campo: misión, pasadas y capturas. La nube de puntos se procesa
          en TBC/POSPac/TMX, fuera de VialRoute.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {state.acquisitionMode !== 'TRIMBLE_LIDAR' ? (
          <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            <Radar className="w-6 h-6 mx-auto mb-2 opacity-60" />
            El modo Trimble no está activo. Cambia a <span className="font-medium text-foreground">Trimble LiDAR</span> en Configuración.
          </div>
        ) : (
          <TrimbleFieldPanel />
        )}
      </div>
    </div>
  );
}

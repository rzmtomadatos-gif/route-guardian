/**
 * Selector de modo de adquisición (RST / GARMIN / TRIMBLE_LIDAR).
 *
 * Usa `setAcquisitionMode` del contexto, que internamente llama a
 * `canChangeAcquisitionMode`. Si hay datos operativos, el cambio se
 * bloquea y se notifica el motivo al operador.
 */
import { useRouteStateContext } from '@/context/RouteStateContext';
import { canChangeAcquisitionMode } from '@/utils/trimble/mode-change-guard';
import { Camera, Video, Radar } from 'lucide-react';
import { toast } from 'sonner';
import type { AcquisitionMode } from '@/types/route';

const OPTIONS: { value: AcquisitionMode; label: string; desc: string; Icon: typeof Camera }[] = [
  { value: 'RST', label: 'RST (F5)', desc: 'Adquisición vehículo RST con confirmaciones F5/F7/F9.', Icon: Camera },
  { value: 'GARMIN', label: 'Garmin', desc: 'Adquisición Dacia + cámara Garmin (cronómetro).', Icon: Video },
  { value: 'TRIMBLE_LIDAR', label: 'Trimble LiDAR', desc: 'Cuaderno de bitácora para captura Trimble (no procesa nube).', Icon: Radar },
];

export function AcquisitionModeSelector() {
  const { state, setAcquisitionMode } = useRouteStateContext();
  const guard = canChangeAcquisitionMode(state);
  const locked = !guard.ok;

  const handle = (mode: AcquisitionMode) => {
    if (mode === state.acquisitionMode) return;
    const r = setAcquisitionMode(mode);
    if (!r.ok) {
      toast.error(r.reason || 'No se puede cambiar de modo ahora.');
    } else {
      toast.success(`Modo de adquisición: ${mode === 'TRIMBLE_LIDAR' ? 'Trimble LiDAR' : mode}`);
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {OPTIONS.map(({ value, label, desc, Icon }) => {
          const active = state.acquisitionMode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => handle(value)}
              disabled={locked && !active}
              className={`flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition-colors ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : locked
                  ? 'border-border bg-secondary/40 text-muted-foreground opacity-60 cursor-not-allowed'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{label}</span>
              </div>
              <p className="text-[10px] leading-snug">{desc}</p>
            </button>
          );
        })}
      </div>
      {locked && (
        <p className="text-[10px] text-amber-500">
          Bloqueado: {guard.reason}. Cierra navegación, tracks y datos operativos para cambiar de modo.
        </p>
      )}
    </div>
  );
}

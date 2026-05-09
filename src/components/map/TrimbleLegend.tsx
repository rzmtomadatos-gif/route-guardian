/**
 * Leyenda visual de estados Trimble. Solo se muestra en el mapa cuando el
 * modo de adquisición activo es TRIMBLE_LIDAR. Es informativa y colapsable
 * para no robar espacio al operador.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Radar } from 'lucide-react';
import { TRIMBLE_STATUS_COLOR } from '@/utils/segment-colors';
import type { TrimbleSegmentStatus } from '@/types/trimble';

const ITEMS: Array<{ status: TrimbleSegmentStatus; label: string }> = [
  { status: 'pendiente', label: 'Pendiente' },
  { status: 'en_captura', label: 'En captura' },
  { status: 'capturado_pendiente_proceso', label: 'Capturado · pendiente proceso' },
  { status: 'repetir', label: 'Repetir' },
  { status: 'no_capturable', label: 'No capturable' },
  { status: 'procesado_ok', label: 'Procesado OK' },
  { status: 'procesado_con_observaciones', label: 'Procesado c/observaciones' },
  { status: 'descartado_por_calidad', label: 'Descartado por calidad' },
];

export function TrimbleLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card/95 backdrop-blur border border-border rounded-lg shadow-md text-xs pointer-events-auto max-w-[240px]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left"
        aria-label="Leyenda Trimble"
      >
        <Radar className="w-3.5 h-3.5 text-primary" />
        <span className="text-[11px] font-medium flex-1">Estados Trimble</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
      </button>
      {open && (
        <ul className="px-2.5 pb-2 space-y-1">
          {ITEMS.map((it) => (
            <li key={it.status} className="flex items-center gap-2 text-[10px]">
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0 border border-border/60"
                style={{ backgroundColor: TRIMBLE_STATUS_COLOR[it.status] }}
              />
              <span className="text-foreground/80">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CloudRain, CloudFog, Construction, Droplets, Car, MoreHorizontal, CircleOff, Circle, Ban, ShieldAlert, TrafficCone, Monitor, Laptop, Server } from 'lucide-react';
import type { IncidentCategory, IncidentImpact } from '@/types/route';
import { sanitizeTextField } from '@/utils/sanitize';

const categories: { value: IncidentCategory; label: string; icon: React.ElementType; defaultImpact: IncidentImpact }[] = [
  { value: 'carretera_cortada', label: 'Cortada', icon: CircleOff, defaultImpact: 'critica_no_grabable' },
  { value: 'obstaculo', label: 'Obstáculo', icon: Ban, defaultImpact: 'informativa' },
  { value: 'obra', label: 'Obra', icon: Construction, defaultImpact: 'informativa' },
  { value: 'acceso_imposible', label: 'Sin acceso', icon: ShieldAlert, defaultImpact: 'critica_no_grabable' },
  { value: 'trafico_extremo', label: 'Tráfico', icon: TrafficCone, defaultImpact: 'informativa' },
  { value: 'lluvia', label: 'Lluvia', icon: CloudRain, defaultImpact: 'critica_no_grabable' },
  { value: 'niebla', label: 'Niebla', icon: CloudFog, defaultImpact: 'informativa' },
  { value: 'bache', label: 'Bache', icon: Circle, defaultImpact: 'informativa' },
  { value: 'inundacion', label: 'Inundación', icon: Droplets, defaultImpact: 'critica_no_grabable' },
  { value: 'accidente', label: 'Accidente', icon: Car, defaultImpact: 'informativa' },
  { value: 'error_sistema_pc360', label: 'Fallo PC360', icon: Monitor, defaultImpact: 'critica_invalida_bloque' },
  { value: 'error_sistema_pc2', label: 'Fallo PC2', icon: Laptop, defaultImpact: 'critica_invalida_bloque' },
  { value: 'error_sistema_linux', label: 'Fallo Linux', icon: Server, defaultImpact: 'critica_invalida_bloque' },
  { value: 'otro', label: 'Otro', icon: MoreHorizontal, defaultImpact: 'informativa' },
];

const impactOptions: { value: IncidentImpact; label: string; description: string; color: string }[] = [
  { value: 'informativa', label: 'Informativa', description: 'Solo registra, no afecta grabación', color: 'border-blue-500/40 bg-blue-500/10 text-blue-400' },
  { value: 'critica_no_grabable', label: 'No grabable', description: 'Sacar tramo del bloque actual', color: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  { value: 'critica_invalida_bloque', label: 'Invalida bloque', description: 'Repetir todo el vídeo/track', color: 'border-destructive/40 bg-destructive/10 text-destructive' },
];

interface Props {
  onSubmit: (category: IncidentCategory, impact: IncidentImpact, note?: string, currentSegmentNonRecordable?: boolean) => void;
  children: React.ReactNode;
}

export function IncidentDialog({ onSubmit, children }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<IncidentCategory | null>(null);
  const [impact, setImpact] = useState<IncidentImpact | null>(null);
  const [note, setNote] = useState('');
  const [currentNonRecordable, setCurrentNonRecordable] = useState(false);

  const handleCategorySelect = (cat: IncidentCategory) => {
    setSelected(cat);
    // Auto-set default impact for this category
    const catDef = categories.find((c) => c.value === cat);
    if (catDef) setImpact(catDef.defaultImpact);
  };

  const handleSubmit = () => {
    if (!selected || !impact) return;
    const cleanNote = note ? sanitizeTextField(note, 2000) : undefined;
    onSubmit(selected, impact, cleanNote || undefined, impact === 'critica_invalida_bloque' ? currentNonRecordable : undefined);
    setSelected(null);
    setImpact(null);
    setNote('');
    setCurrentNonRecordable(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="bg-card border-border max-w-sm mx-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Registrar Incidencia
          </DialogTitle>
        </DialogHeader>

        {/* Category selection */}
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Tipo</p>
        <div className="grid grid-cols-4 gap-1.5">
          {categories.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => handleCategorySelect(value)}
              className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all driving-button ${
                selected === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/30'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-medium leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>

        {/* Impact selection – only show after category selected */}
        {selected && (
          <>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mt-2">Impacto</p>
            <div className="space-y-1.5">
              {impactOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setImpact(opt.value)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left ${
                    impact === opt.value
                      ? opt.color
                      : 'border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{opt.label}</p>
                    <p className="text-[9px] opacity-70">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Checkbox: current segment non-recordable (only for block invalidation) */}
        {impact === 'critica_invalida_bloque' && (
          <label className="flex items-center gap-2 mt-2 p-2.5 rounded-lg border border-border cursor-pointer hover:border-foreground/30 transition-colors">
            <input
              type="checkbox"
              checked={currentNonRecordable}
              onChange={(e) => setCurrentNonRecordable(e.target.checked)}
              className="w-4 h-4 accent-destructive"
            />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">Tramo actual NO grabable</p>
              <p className="text-[9px] text-muted-foreground">Este tramo se excluye del itinerario (los anteriores del track sí se repiten)</p>
            </div>
          </label>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota opcional..."
          className="w-full mt-2 p-3 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm resize-none h-16"
        />
        <Button
          onClick={handleSubmit}
          disabled={!selected || !impact}
          className="w-full driving-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Guardar Incidencia
        </Button>
      </DialogContent>
    </Dialog>
  );
}

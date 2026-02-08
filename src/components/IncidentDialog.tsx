import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CloudRain, CloudFog, Construction, Droplets, Car, MoreHorizontal, CircleOff, Circle } from 'lucide-react';
import type { IncidentCategory } from '@/types/route';

const categories: { value: IncidentCategory; label: string; icon: React.ElementType }[] = [
  { value: 'lluvia', label: 'Lluvia', icon: CloudRain },
  { value: 'niebla', label: 'Niebla', icon: CloudFog },
  { value: 'bache', label: 'Bache', icon: Circle },
  { value: 'obra', label: 'Obra', icon: Construction },
  { value: 'carretera_cortada', label: 'Cortada', icon: CircleOff },
  { value: 'inundacion', label: 'Inundación', icon: Droplets },
  { value: 'accidente', label: 'Accidente', icon: Car },
  { value: 'otro', label: 'Otro', icon: MoreHorizontal },
];

interface Props {
  onSubmit: (category: IncidentCategory, note?: string) => void;
  children: React.ReactNode;
}

export function IncidentDialog({ onSubmit, children }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<IncidentCategory | null>(null);
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    if (!selected) return;
    onSubmit(selected, note || undefined);
    setSelected(null);
    setNote('');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="bg-card border-border max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Registrar Incidencia
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {categories.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setSelected(value)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all driving-button ${
                selected === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/30'
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nota opcional..."
          className="w-full mt-3 p-3 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground text-sm resize-none h-20"
        />
        <Button
          onClick={handleSubmit}
          disabled={!selected}
          className="w-full driving-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Guardar Incidencia
        </Button>
      </DialogContent>
    </Dialog>
  );
}

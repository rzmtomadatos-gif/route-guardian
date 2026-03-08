import { CheckCircle, Clock, AlertTriangle, Layers } from 'lucide-react';

interface Props {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  incidents: number;
  possibleRepeat: number;
}

export function CampaignSummary({ total, pending, inProgress, completed, incidents, possibleRepeat }: Props) {
  return (
    <div className="grid grid-cols-4 gap-1.5 px-3 py-2 bg-secondary/30 border-b border-border">
      <div className="flex flex-col items-center">
        <span className="text-sm font-bold text-foreground">{total}</span>
        <span className="text-[9px] text-muted-foreground">Totales</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-sm font-bold text-muted-foreground">{pending}</span>
        <span className="text-[9px] text-muted-foreground">Pendientes</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-sm font-bold text-success">{completed}</span>
        <span className="text-[9px] text-muted-foreground">Grabados</span>
      </div>
      <div className="flex flex-col items-center">
        <span className={`text-sm font-bold ${incidents > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{incidents}</span>
        <span className="text-[9px] text-muted-foreground">Incidencias</span>
      </div>
    </div>
  );
}

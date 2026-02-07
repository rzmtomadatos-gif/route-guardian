import { Button } from '@/components/ui/button';
import { Trash2, Info } from 'lucide-react';

interface Props {
  onClear: () => void;
  hasRoute: boolean;
}

export default function SettingsPage({ onClear, hasRoute }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 py-3 bg-card border-b border-border">
        <h2 className="text-lg font-bold text-foreground">Configuración</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* App info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info className="w-4 h-4" />
            <span className="text-sm font-medium">Acerca de</span>
          </div>
          <div className="bg-card rounded-xl p-4 border border-border space-y-2">
            <p className="text-sm text-foreground font-medium">VialRoute</p>
            <p className="text-xs text-muted-foreground">
              Aplicación de auscultación vial para optimización y guía de rutas de grabación.
            </p>
            <p className="text-xs text-muted-foreground">Versión 1.0.0 — MVP</p>
          </div>
        </div>

        {/* Data */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-muted-foreground">Datos</span>
          <div className="bg-card rounded-xl p-4 border border-border space-y-3">
            <p className="text-xs text-muted-foreground">
              Los datos se almacenan localmente en este dispositivo. Borrar datos eliminará la ruta actual y todas las incidencias registradas.
            </p>
            <Button
              onClick={onClear}
              disabled={!hasRoute}
              variant="outline"
              className="w-full driving-button border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Borrar todos los datos
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

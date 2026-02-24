import { Link, useLocation } from 'react-router-dom';
import { Upload, Map, List, Settings, Save, X } from 'lucide-react';
import { routeToKml, downloadKml } from '@/utils/kml-export';
import { toast } from '@/hooks/use-toast';
import type { Route } from '@/types/route';

const navItems = [
  { to: '/', icon: Upload, label: 'Cargar' },
  { to: '/map', icon: Map, label: 'Mapa' },
  { to: '/segments', icon: List, label: 'Tramos' },
  { to: '/settings', icon: Settings, label: 'Config' },
];

interface Props {
  children: React.ReactNode;
  route?: Route | null;
  isDirty?: boolean;
  onMarkClean?: () => void;
  selectedCount?: number;
  onClearSelection?: () => void;
}

export function AppLayout({ children, route, isDirty, onMarkClean, selectedCount = 0, onClearSelection }: Props) {
  const location = useLocation();

  const handleSave = () => {
    if (!route) return;
    const kml = routeToKml(route);
    downloadKml(kml, route.fileName || `${route.name}.kml`);
    onMarkClean?.();
    toast({ title: 'Guardado', description: `${route.fileName} exportado correctamente.` });
  };

  const handleSaveAs = () => {
    if (!route) return;
    const newName = prompt('Nombre del archivo:', route.name + '_copia');
    if (!newName) return;
    const kml = routeToKml(route);
    downloadKml(kml, `${newName}.kml`);
    toast({ title: 'Guardado como', description: `${newName}.kml exportado correctamente.` });
  };

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <main className="flex-1 overflow-y-auto">{children}</main>
      {selectedCount > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-accent/15 border-t border-accent/20">
          <span className="text-[10px] font-medium text-accent-foreground">
            {selectedCount} tramo{selectedCount > 1 ? 's' : ''} seleccionado{selectedCount > 1 ? 's' : ''}
          </span>
          <button
            onClick={onClearSelection}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
            Limpiar selección
          </button>
        </div>
      )}
      <nav className="flex-shrink-0 border-t border-border bg-card safe-area-bottom">
        <div className="flex justify-around py-2">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
          {/* Save button in nav */}
          {route && (
            <div className="flex flex-col items-center gap-1 relative">
              <button
                onClick={handleSave}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleSaveAs();
                }}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  isDirty
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Guardar (click derecho: Guardar como)"
              >
                <div className="relative">
                  <Save className="w-5 h-5" />
                  {isDirty && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-destructive" />
                  )}
                </div>
                <span className="text-[10px] font-medium">Guardar</span>
              </button>
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}

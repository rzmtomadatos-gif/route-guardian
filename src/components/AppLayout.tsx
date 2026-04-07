import { Link, useLocation } from 'react-router-dom';
import { Upload, Map, List, Settings, X, WifiOff } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { to: '/', icon: Upload, label: 'Cargar' },
  { to: '/map', icon: Map, label: 'Mapa' },
  { to: '/segments', icon: List, label: 'Tramos' },
  { to: '/settings', icon: Settings, label: 'Config' },
];

interface Props {
  children: React.ReactNode;
  selectedCount?: number;
  onClearSelection?: () => void;
}

export function AppLayout({ children, selectedCount = 0, onClearSelection }: Props) {
  const location = useLocation();
  const { isOfflineMode } = useAuth();

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
        <div className="flex justify-around items-center py-2">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to;
            const isConfig = to === '/settings';
            return (
              <Link
                key={to}
                to={to}
                className={`relative flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{label}</span>
                {isConfig && isOfflineMode && (
                  <WifiOff className="absolute -top-0.5 -right-0.5 w-3 h-3 text-amber-400" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
      
    </div>
  );
}

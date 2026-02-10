import { Link, useLocation } from 'react-router-dom';
import { Upload, Map, List, Settings } from 'lucide-react';

const navItems = [
  { to: '/', icon: Upload, label: 'Cargar' },
  { to: '/map', icon: Map, label: 'Mapa' },
  { to: '/segments', icon: List, label: 'Tramos' },
  { to: '/settings', icon: Settings, label: 'Config' },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <main className="flex-1 overflow-y-auto">{children}</main>
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
        </div>
      </nav>
    </div>
  );
}

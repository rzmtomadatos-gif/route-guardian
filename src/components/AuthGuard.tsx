import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Loader2, WifiOff } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

export function AuthGuard({ children }: Props) {
  const { user, loading, isOfflineMode } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-background gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Verificando sesión...</span>
      </div>
    );
  }

  // No session, no local fallback → must login
  if (!user && !isOfflineMode) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      {isOfflineMode && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-warning/15 border-b border-warning/30 text-warning text-xs font-medium">
          <WifiOff className="w-3.5 h-3.5" />
          Modo local — sesión cloud inactiva. Reconecta para funciones remotas.
        </div>
      )}
      {children}
    </>
  );
}

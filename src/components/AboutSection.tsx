import { Info, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePwaUpdate } from '@/hooks/usePwaUpdate';

/**
 * Sección "Acerca de" en Settings: muestra versión actual y permite
 * comprobar manualmente si hay una nueva versión PWA disponible.
 */
export function AboutSection() {
  const {
    currentVersion,
    currentBuildTime,
    latestVersion,
    needRefresh,
    checking,
    checkForUpdate,
    lastChecked,
  } = usePwaUpdate();

  const formattedBuild = currentBuildTime
    ? new Date(currentBuildTime).toLocaleString()
    : '—';
  const formattedChecked = lastChecked ? lastChecked.toLocaleTimeString() : 'nunca';

  // Diferencia entre la versión instalada y la publicada (informativo).
  const hasNewer =
    needRefresh ||
    (latestVersion !== null && latestVersion !== currentVersion);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Info className="w-4 h-4" />
        <span className="text-sm font-medium">Acerca de</span>
      </div>
      <div className="bg-card rounded-xl p-4 border border-border space-y-3">
        <div className="space-y-1">
          <p className="text-sm text-foreground font-medium">VialRoute</p>
          <p className="text-xs text-muted-foreground">
            Aplicación de auscultación vial para optimización y guía de rutas de grabación.
          </p>
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5 pt-1 border-t border-border">
          <p>
            <span className="text-foreground/80">Versión instalada:</span>{' '}
            <span className="font-mono">{currentVersion}</span>
          </p>
          <p>
            <span className="text-foreground/80">Build:</span> {formattedBuild}
          </p>
          {latestVersion && latestVersion !== currentVersion && (
            <p>
              <span className="text-foreground/80">Versión publicada:</span>{' '}
              <span className="font-mono">{latestVersion}</span>
            </p>
          )}
          <p>
            <span className="text-foreground/80">Última comprobación:</span> {formattedChecked}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={() => void checkForUpdate()}
            disabled={checking}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Comprobando…' : 'Buscar actualizaciones'}
          </Button>
          {!hasNewer && !checking && lastChecked && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              Estás en la última versión
            </span>
          )}
          {hasNewer && (
            <span className="text-xs text-primary font-medium">
              Nueva versión disponible
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

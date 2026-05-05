import { useState } from 'react';
import { Info, RefreshCw, CheckCircle2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePwaUpdate } from '@/hooks/usePwaUpdate';
import { toast } from 'sonner';

interface Props {
  /** True si hay navegación en curso — exigir confirmación antes de recargar. */
  navigationActive?: boolean;
}

/**
 * Sección "Acerca de" en Settings: muestra versión actual, permite comprobar
 * y aplicar manualmente actualizaciones PWA sin perder datos locales.
 *
 * Diferencia clave entre estados:
 * - "Versión publicada detectada": /version.json devuelve una versión > instalada,
 *   pero el Service Worker puede no haber terminado de descargar aún.
 * - "Actualización lista para aplicar": el Service Worker tiene un worker en
 *   estado `waiting`, listo para activarse con skipWaiting + reload.
 *
 * El botón "Actualizar ahora" usa `prepareAndApplyUpdate()` que reconcilia
 * ambos estados: fuerza al SW a comprobar, espera brevemente al waiting y
 * aplica si está listo. Si no, informa y permite reintentar SIN recargar
 * a ciegas (evita servir la misma versión antigua).
 */
export function AboutSection({ navigationActive = false }: Props) {
  const {
    currentVersion,
    currentBuildTime,
    latestVersion,
    needRefresh,
    checking,
    checkForUpdate,
    prepareAndApplyUpdate,
    lastChecked,
    versionFileUnavailable,
  } = usePwaUpdate();

  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const formattedBuild = currentBuildTime
    ? new Date(currentBuildTime).toLocaleString()
    : '—';
  const formattedChecked = lastChecked ? lastChecked.toLocaleTimeString() : 'nunca';

  // Hay versión nueva si:
  //  - el SW ya tiene un worker waiting (needRefresh=true), o
  //  - /version.json reporta una versión distinta a la instalada
  const versionMismatch =
    latestVersion !== null && latestVersion !== currentVersion;
  const hasNewer = needRefresh || versionMismatch;

  const doApply = async () => {
    setApplying(true);
    try {
      const result = await prepareAndApplyUpdate();
      if (result.status === 'applied') {
        toast.success('Aplicando actualización…');
        // La recarga la dispara controllerchange o updateSW(true)
      } else {
        toast.warning(result.message, { duration: 8000 });
      }
    } catch (e) {
      toast.error('No se pudo aplicar la actualización. Inténtalo de nuevo.');
    } finally {
      setApplying(false);
    }
  };

  const handleApplyClick = () => {
    if (navigationActive) {
      setConfirmOpen(true);
    } else {
      void doApply();
    }
  };

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

        {hasNewer && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-2.5 space-y-2">
            <p className="text-xs text-primary font-medium">
              Nueva versión disponible
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Se aplicará sin borrar la campaña ni los datos locales.
            </p>
            <Button
              onClick={handleApplyClick}
              disabled={applying}
              size="sm"
              className="w-full gap-2"
            >
              <Download className={`w-3.5 h-3.5 ${applying ? 'animate-pulse' : ''}`} />
              {applying ? 'Actualizando…' : 'Actualizar ahora'}
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={() => void checkForUpdate()}
            disabled={checking || applying}
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
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hay navegación activa</AlertDialogTitle>
            <AlertDialogDescription>
              La actualización requiere recargar la aplicación. La navegación en curso
              se interrumpirá. Los datos locales (campaña, tramos, event log) NO se
              borrarán. ¿Quieres actualizar ahora?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir trabajando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void doApply();
              }}
            >
              Actualizar y recargar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

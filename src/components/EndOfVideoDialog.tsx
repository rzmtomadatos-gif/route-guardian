import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { AlertOctagon, CheckCircle2, Square } from 'lucide-react';
import { useState } from 'react';

interface Props {
  open: boolean;
  trackNumber: number;
  rstGroupSize?: number;
  onContinue: () => void;
}

const STEPS = [
  {
    label: 'Detener la medición actual del tramo',
    detail: 'Comprobar que el sistema indica:',
    code: 'MEDICIÓN PARADA',
  },
  {
    label: 'Verificar que el equipo está preparado',
    detail: 'El sistema debe estar en estado:',
    code: 'MEDICIÓN PARADA\nPULSA INSERT PARA INICIAR UNA NUEVA MEDIDA',
  },
  {
    label: 'Confirmar que el vehículo está listo',
    detail: 'Conductor preparado · Ruta correcta en el navegador',
    code: null,
  },
  {
    label: 'Cuando todo esté listo, iniciar nueva medición',
    detail: 'Pulsar INSERT en el sistema del equipo multifunción',
    code: null,
  },
];

export function EndOfVideoDialog({ open, trackNumber, rstGroupSize = 9, onContinue }: Props) {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const allChecked = checked.size === STEPS.length;

  function toggle(idx: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function handleContinue() {
    setChecked(new Set());
    onContinue();
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0">
              <AlertOctagon className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <AlertDialogTitle className="text-base leading-tight">
                BLOQUE COMPLETADO ({rstGroupSize}/{rstGroupSize})
              </AlertDialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">Preparar nueva medición</p>
            </div>
          </div>

          <AlertDialogDescription asChild>
            <div className="space-y-3 pt-2">
              <p className="text-xs font-semibold text-foreground">
                Procedimiento antes de iniciar el siguiente tramo:
              </p>
              <ol className="space-y-2">
                {STEPS.map((step, i) => {
                  const isChecked = checked.has(i);
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2 cursor-pointer select-none group"
                      onClick={() => toggle(i)}
                    >
                      <span className="mt-0.5 flex-shrink-0">
                        {isChecked ? (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        ) : (
                          <Square className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                        )}
                      </span>
                      <div className={isChecked ? 'opacity-60' : ''}>
                        <p className="text-sm font-medium text-foreground leading-tight">
                          {i + 1}. {step.label}
                        </p>
                        <p className="text-xs text-muted-foreground">{step.detail}</p>
                        {step.code && (
                          <pre className="mt-1 text-[11px] font-mono bg-secondary/80 text-amber-500 px-2 py-1 rounded border border-border whitespace-pre-wrap">
                            {step.code}
                          </pre>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <p className="text-xs text-destructive font-medium text-center">
          El siguiente tramo no puede iniciarse hasta confirmar que el equipo está preparado.
        </p>

        <AlertDialogFooter className="mt-3">
          <AlertDialogAction
            onClick={handleContinue}
            disabled={!allChecked}
            className="bg-primary text-primary-foreground disabled:opacity-40"
          >
            Continuar — Equipo preparado
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

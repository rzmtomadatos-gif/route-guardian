import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onConfirm: (code: string, name: string) => void;
}

export function ProjectCodeDialog({ open, onConfirm }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const trimmedCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const canConfirm = trimmedCode.length >= 1;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmedCode, name.trim() || trimmedCode);
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Identificación del proyecto</DialogTitle>
          <DialogDescription>
            Introduce un código corto y un nombre para el proyecto. El código se usará para generar
            los identificadores únicos de cada tramo (ej: BOA_00001).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="project-code">Código del proyecto *</Label>
            <Input
              id="project-code"
              placeholder="BOA"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={10}
              className="uppercase"
            />
            <p className="text-xs text-muted-foreground">
              Se usará para IDs: {trimmedCode || '???'}_00001
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-name">Nombre del proyecto</Label>
            <Input
              id="project-name"
              placeholder="Boadilla del Monte 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Para encabezados y exportación
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

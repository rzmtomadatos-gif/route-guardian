/**
 * Renderiza el control adecuado para corregir un campo concreto.
 * Aísla el switch tipo→input para mantener `CorrectionApplyDialog` simple.
 */

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CorrectableField } from '@/types/route';
import {
  getFieldInputKind,
  STATUS_OPTIONS,
  DIRECTION_OPTIONS,
  TYPE_OPTIONS,
} from './field-types';

interface Props {
  field: CorrectableField;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function CorrectionFieldEditor({ field, value, onChange }: Props) {
  const kind = getFieldInputKind(field);

  switch (kind) {
    case 'string':
      return (
        <Input
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nuevo valor"
        />
      );

    case 'text':
      return (
        <Textarea
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nuevo valor"
          rows={3}
        />
      );

    case 'number': {
      const numStr = value === null || value === undefined ? '' : String(value);
      return (
        <Input
          type="number"
          inputMode="numeric"
          value={numStr}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(undefined);
              return;
            }
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            onChange(n);
          }}
          placeholder="Nuevo valor (vaciar = sin valor)"
        />
      );
    }

    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(Boolean(v))}
          />
          <Label className="text-sm text-muted-foreground">
            {Boolean(value) ? 'Sí' : 'No'}
          </Label>
        </div>
      );

    case 'status':
    case 'direction':
    case 'type': {
      const options =
        kind === 'status'
          ? STATUS_OPTIONS
          : kind === 'direction'
            ? DIRECTION_OPTIONS
            : TYPE_OPTIONS;
      const current = (value as string | undefined) ?? '';
      return (
        <Select value={current} onValueChange={(v) => onChange(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona un valor" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    default: {
      // Exhaustividad: si se añade un kind nuevo, TS lo señala
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}

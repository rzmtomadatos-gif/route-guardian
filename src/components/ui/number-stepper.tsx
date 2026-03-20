import { Button } from '@/components/ui/button';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NumberStepperProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}

export function NumberStepper({ value, min = 1, max = 999, step = 1, onChange, className }: NumberStepperProps) {
  const decrement = () => {
    const next = value - step;
    if (next >= min) onChange(next);
  };

  const increment = () => {
    const next = value + step;
    if (next <= max) onChange(next);
  };

  return (
    <div className={cn('inline-flex items-center gap-0.5', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={decrement}
        disabled={value <= min}
        className="h-7 w-7 rounded-md bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-30"
      >
        <Minus className="w-3 h-3" />
      </Button>
      <span className="min-w-[1.75rem] text-center text-xs font-semibold text-foreground tabular-nums">
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={increment}
        disabled={value >= max}
        className="h-7 w-7 rounded-md bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-30"
      >
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
}

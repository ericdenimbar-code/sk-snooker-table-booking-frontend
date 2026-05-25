'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  dateToHkDatetimeLocalValue,
  hkDatetimeLocalValueToDate,
} from '@/lib/notifications/time';
import { cn } from '@/lib/utils';

type DateTimePickerProps = {
  id?: string;
  label?: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  disabled?: boolean;
  className?: string;
};

export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  disabled = false,
  className,
}: DateTimePickerProps) {
  const inputId = id ?? label?.replace(/\s/g, '-').toLowerCase();

  return (
    <div className={cn('grid gap-2', className)}>
      {label ? <Label htmlFor={inputId}>{label}</Label> : null}
      <Input
        id={inputId}
        type="datetime-local"
        value={dateToHkDatetimeLocalValue(value)}
        onChange={(e) => onChange(hkDatetimeLocalValueToDate(e.target.value))}
        disabled={disabled}
        className={cn(disabled && 'opacity-50')}
      />
      <p className="text-xs text-muted-foreground">時區：Asia/Hong_Kong (HKT)</p>
    </div>
  );
}

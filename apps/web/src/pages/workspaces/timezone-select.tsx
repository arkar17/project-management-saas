import { useMemo } from 'react';
import { SelectField } from '../../components/ui/select';

function zones(current: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return Array.from(new Set(['UTC', current, ...all]));
}

export function TimezoneSelect({
  value,
  onChange,
  error,
  disabled,
  label = 'Reporting timezone',
}: {
  label?: string;
  value: string;
  onChange: (tz: string) => void;
  error?: string | undefined;
  disabled?: boolean;
}) {
  const options = useMemo(() => zones(value), [value]);
  return (
    <SelectField
      label={label}
      value={value}
      error={error}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((tz) => (
        <option key={tz} value={tz}>
          {tz.replaceAll('_', ' ')}
        </option>
      ))}
    </SelectField>
  );
}

import { useId, type SelectHTMLAttributes } from 'react';

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string | undefined;
  hideLabel?: boolean;
}

export function SelectField({
  label,
  error,
  hideLabel,
  className = '',
  children,
  ...props
}: SelectFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-sm font-medium'}>
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        className={`h-10 w-full rounded-md border border-border bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:bg-slate-100 ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

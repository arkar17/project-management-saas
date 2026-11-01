import type { ReactNode } from 'react';

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info';
  children: ReactNode;
}) {
  const styles =
    tone === 'error'
      ? 'border-destructive/30 bg-red-50 text-destructive'
      : 'border-primary/20 bg-indigo-50 text-primary';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border p-3 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

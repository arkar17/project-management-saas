import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { Alert } from './ui/alert';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-center text-sm text-muted">
      {label}
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="mt-2 space-y-4 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Maps API failures to user-facing states: 404 and 403 are distinct, never leaked details. */
export function ErrorState({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.status === 404)
      return <Alert>This page does not exist or you no longer have access.</Alert>;
    if (error.body.code === 'EMAIL_NOT_VERIFIED')
      return <Alert>Verify your email address to continue.</Alert>;
    if (error.status === 403) return <Alert>You do not have permission to view this.</Alert>;
  }
  return <Alert>Something went wrong. Please try again.</Alert>;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

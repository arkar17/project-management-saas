import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Native <dialog>: focus trapping, Escape and inert background come from the browser. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border p-6 shadow-xl backdrop:bg-slate-900/40"
    >
      <h2 id="confirm-title" className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm text-slate-600">{children}</div>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          className="bg-white text-slate-900 ring-1 ring-border sm:w-auto"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className={`sm:w-auto ${destructive ? 'bg-destructive' : ''}`}
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

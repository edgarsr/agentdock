import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from './ui/Button';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  showCancelButton?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  secondaryActionLabel,
  onSecondaryAction,
  showCancelButton = true,
  onConfirm,
  onCancel
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const timer = window.setTimeout(() => {
      dialog.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-200"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        tabIndex={-1}
        className="relative flex w-full max-w-[400px] flex-col rounded-[9px] border border-border
          bg-[var(--ide-Panel-background)] text-foreground shadow-[0_18px_48px_rgba(0,0,0,0.38)]
          animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }

          if (e.key !== 'Tab') return;

          const dialog = dialogRef.current;
          if (!dialog) return;

          const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter((element) => !element.hasAttribute('disabled'));

          if (focusable.length === 0) {
            e.preventDefault();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement as HTMLElement | null;

          if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          } else if (e.shiftKey && (active === first || active === dialog)) {
            e.preventDefault();
            last.focus();
          }
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-2 top-2 rounded-[4px] p-1 text-foreground-secondary transition-colors
            hover:bg-background hover:text-foreground focus:outline-none
            focus-visible:shadow-[0_0_0_1px_var(--ide-Button-default-focusColor)]"
          aria-label="Close dialog"
        >
          <X size={15} />
        </button>

        <div className="flex items-start gap-3 px-5 pb-3 pt-5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ide-Button-default-startBackground)] text-white">
            <span className="text-[15px] leading-none">?</span>
          </div>
          <div className="min-w-0 flex-1">
            <div id="confirmation-dialog-title" className="font-semibold text-sm">{title}</div>
            <p className="mt-1 min-w-0 max-w-full text-ide-small whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 pb-4 pt-2 mt-2">
          {secondaryActionLabel && onSecondaryAction && (
            <Button onClick={onSecondaryAction} variant="secondary" className="min-w-[4.7em]">{secondaryActionLabel}</Button>
          )}
          {showCancelButton && (
            <Button onClick={onCancel} variant="secondary" className="min-w-[4.7em]">{cancelLabel}</Button>
          )}
          <Button onClick={onConfirm} variant="primary" className="min-w-[4.7em]">{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

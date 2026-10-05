import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` makes the confirm button red, for destructive actions. */
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Themed replacement for window.confirm(). Moves focus to Cancel when it
 * opens (the safe default), traps Tab between the two buttons, closes on
 * Escape or a click outside, and returns focus to whatever opened it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element | null {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Tab") {
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="ui-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={handleKeyDown}>
      <div className="ui-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
        <h2 className="ui-dialog__title" id={titleId}>
          {title}
        </h2>
        <p className="ui-dialog__message" id={messageId}>
          {message}
        </p>
        <div className="ui-dialog__actions">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={tone === "danger" ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

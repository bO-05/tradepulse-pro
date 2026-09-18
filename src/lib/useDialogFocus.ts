import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// A2-09: while any modal is open the page behind it must not scroll. A counter
// keeps nested dialogs from unlocking the body when the inner one closes.
let bodyLockCount = 0;
let previousOverflow = "";

export function lockBodyScroll(): () => void {
  if (bodyLockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      document.body.style.overflow = previousOverflow;
    }
  };
}

/**
 * A2-05: consistent Escape-to-close for dialogs that handle their own key events.
 */
export function useEscapeToClose(open: boolean, onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!open || !enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, enabled]);
}

/**
 * Completes the modal contract for dialogs: on open, focus moves inside the dialog;
 * Tab/Shift+Tab are trapped within it; on close, focus is restored to the element
 * that opened the dialog. Escape handling stays with the caller to avoid double-close.
 */
export function useDialogFocus<T extends HTMLElement>(open: boolean) {
  const containerRef = useRef<T | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) || null;
    const releaseScrollLock = lockBodyScroll();

    const focusables = () => {
      const node = containerRef.current;
      if (!node) return [] as HTMLElement[];
      return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
    };

    const initial = focusables();
    if (initial.length > 0) {
      initial[0].focus();
    } else if (containerRef.current) {
      containerRef.current.setAttribute("tabindex", "-1");
      containerRef.current.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const node = containerRef.current;
      if (!node) return;
      // A6-01: when a ConfirmDialog (alertdialog) is stacked above this dialog,
      // its own trap owns Tab; this trap must stand down or focus escapes.
      const topmostConfirm = document.querySelector('[role="alertdialog"][aria-modal="true"]');
      if (topmostConfirm && !node.contains(topmostConfirm)) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !node.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      releaseScrollLock();
      const restore = restoreRef.current;
      if (restore && document.contains(restore) && typeof restore.focus === "function") {
        restore.focus();
      }
    };
  }, [open]);

  return containerRef;
}
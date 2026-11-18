import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

// Recent focus targets, so a surface that autofocuses one of its own controls on mount can still
// find the element that opened it.
const history: Element[] = [];
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    e => {
      if (e.target instanceof Element) {
        history.push(e.target);
        if (history.length > 20) history.shift();
      }
    },
    true
  );
}
function openerFor(root: HTMLElement): HTMLElement | null {
  const current = document.activeElement;
  if (current && current !== document.body && !root.contains(current)) return current as HTMLElement;
  for (let i = history.length - 1; i >= 0; i--) {
    const el = history[i];
    if (el.isConnected && !root.contains(el)) return el as HTMLElement;
  }
  return null;
}

/** Visible, keyboard-reachable elements inside `root`, in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => !el.closest('[inert]') && (el.offsetParent !== null || el === document.activeElement)
  );
}

/**
 * Keeps keyboard focus inside a modal surface (WCAG 2.1.2 / 2.4.3):
 * focuses the element marked `data-autofocus` (else the first control, else the container),
 * wraps Tab / Shift+Tab, and gives focus back to the opener on close.
 */
export function useFocusTrap<T extends HTMLElement>(active = true): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = openerFor(root);
    if (!root.contains(document.activeElement)) {
      const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
      (preferred || focusableIn(root)[0] || root).focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !root.isConnected) return;
      // Only the top-most trap handles Tab (dialogs can stack).
      const traps = document.querySelectorAll('[data-focus-trap]');
      if (traps[traps.length - 1] !== root) return;
      const items = focusableIn(root);
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    root.setAttribute('data-focus-trap', '');
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      root.removeAttribute('data-focus-trap');
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, [active]);
  return ref;
}

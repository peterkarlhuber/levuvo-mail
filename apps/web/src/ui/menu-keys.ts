import type { KeyboardEvent } from 'react';

/**
 * Keyboard behaviour of a WAI-ARIA menu: arrows and Home/End move between the items, Escape
 * closes and returns focus to the button that opened it, Tab closes and moves on.
 */
export function menuKeyDown(e: KeyboardEvent<HTMLElement>, close: (refocus: boolean) => void) {
  const list = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'));
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close(true);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    e.stopPropagation();
    list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
  } else if (e.key === 'Tab') close(false);
}

/** Focuses the first enabled item of a menu that just opened. */
export function focusFirstItem(menu: HTMLElement | null) {
  menu?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
}

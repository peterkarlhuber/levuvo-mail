import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useT } from '../i18n';

export type ToolbarItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Show the label next to the icon while there is room (primary actions). */
  showLabel?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Lower numbers stay visible longest when space runs out (default 10). */
  priority?: number;
};

/**
 * ARIA toolbar with a single tab stop (arrow keys move between items) and automatic
 * overflow: items that don't fit move into a "More" menu instead of wrapping onto new lines.
 */
export function Toolbar({
  items,
  label,
  className,
  end
}: {
  items: ToolbarItem[];
  /** Accessible name, e.g. "Message actions". */
  label: string;
  className?: string;
  /** Extra content after the items (e.g. a select). Not part of the overflow. */
  end?: ReactNode;
}) {
  const { t } = useT();
  const root = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set(items.map(i => i.id)));
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const key = items.map(i => `${i.id}:${i.showLabel ? 1 : 0}`).join('|');

  useLayoutEffect(() => {
    const el = root.current;
    const m = measure.current;
    if (!el || !m) return;
    const compute = () => {
      const widths = new Map<string, number>();
      m.querySelectorAll<HTMLElement>('[data-id]').forEach(n => widths.set(n.dataset.id!, n.offsetWidth));
      const gap = 4;
      const endW = (el.querySelector<HTMLElement>('.ui-toolbar-end')?.offsetWidth || 0) + (end ? gap : 0);
      const moreW = (m.querySelector<HTMLElement>('[data-more]')?.offsetWidth || 36) + gap;
      const avail = el.clientWidth - endW;
      const total = items.reduce((s, i) => s + (widths.get(i.id) || 0) + gap, 0);
      if (total <= avail) {
        setVisibleIds(new Set(items.map(i => i.id)));
        return;
      }
      const ranked = [...items].sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
      const keep = new Set<string>();
      let used = moreW;
      for (const it of ranked) {
        const w = (widths.get(it.id) || 0) + gap;
        if (used + w > avail) break;
        used += w;
        keep.add(it.id);
      }
      setVisibleIds(keep);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!end]);

  const visible = items.filter(i => visibleIds.has(i.id));
  const hidden = items.filter(i => !visibleIds.has(i.id));
  const stops = visible.length + (hidden.length ? 1 : 0);
  const current = Math.min(focusIndex, Math.max(0, stops - 1));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    let next = -1;
    if (dir) next = (current + dir + stops) % stops;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = stops - 1;
    if (next < 0 || (e.target as HTMLElement).closest('.ui-toolbar-end, .menu')) return;
    e.preventDefault();
    setFocusIndex(next);
    root.current?.querySelectorAll<HTMLElement>(':scope > .ui-toolbar-items > button')[next]?.focus();
  }

  const renderItem = (it: ToolbarItem, i: number, measuring = false) => (
    <button
      key={it.id}
      data-id={it.id}
      type="button"
      className={['btn', 'toolbar-item', it.showLabel ? '' : 'icon-only', it.danger ? 'danger' : '']
        .filter(Boolean)
        .join(' ')}
      aria-label={it.showLabel ? undefined : it.label}
      title={it.label}
      aria-pressed={it.pressed}
      disabled={it.disabled}
      tabIndex={measuring ? -1 : i === current ? 0 : -1}
      onFocus={measuring ? undefined : () => setFocusIndex(i)}
      onClick={measuring ? undefined : it.onSelect}
    >
      {it.icon && <span aria-hidden="true">{it.icon}</span>}
      {it.showLabel && <span className="label">{it.label}</span>}
    </button>
  );

  return (
    <div
      ref={root}
      className={['ui-toolbar', className].filter(Boolean).join(' ')}
      role="toolbar"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <div ref={measure} className="ui-toolbar-measure" aria-hidden="true" inert>
        {items.map((it, i) => renderItem(it, i, true))}
        <button type="button" className="btn toolbar-item icon-only" data-more tabIndex={-1}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div className="ui-toolbar-items">
        {visible.map((it, i) => renderItem(it, i))}
        {hidden.length > 0 && (
          <OverflowMenu
            items={hidden}
            open={menuOpen}
            setOpen={setMenuOpen}
            label={t('Weitere Aktionen')}
            tabIndex={current === visible.length ? 0 : -1}
            onFocus={() => setFocusIndex(visible.length)}
          />
        )}
      </div>
      {end && <div className="ui-toolbar-end">{end}</div>}
    </div>
  );
}

function OverflowMenu({
  items,
  open,
  setOpen,
  label,
  tabIndex,
  onFocus
}: {
  items: ToolbarItem[];
  open: boolean;
  setOpen: (v: boolean) => void;
  label: string;
  tabIndex: number;
  onFocus: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') || []);
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
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
  return (
    <span className="menu-anchor">
      <button
        ref={button}
        type="button"
        className="btn toolbar-item icon-only"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onClick={() => setOpen(!open)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="menu-dismiss"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => close(false)}
          />
          <div ref={menu} className="menu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
            {items.map(it => (
              <button
                key={it.id}
                type="button"
                role={it.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={it.pressed}
                className={it.danger ? 'danger' : ''}
                disabled={it.disabled}
                tabIndex={-1}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                {it.icon && <span aria-hidden="true">{it.icon}</span>}
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

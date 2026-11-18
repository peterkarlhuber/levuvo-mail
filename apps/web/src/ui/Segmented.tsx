import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export type SegmentedOption<T> = { value: T; label: ReactNode; disabled?: boolean };

/**
 * Single choice from 2–5 options (ARIA radiogroup).
 * Keyboard: only the selected option is a tab stop; arrow keys, Home and End move and select.
 */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  className
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter(o => !o.disabled);
  const selectedIndex = options.findIndex(o => o.value === value);
  const tabStop = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : options.indexOf(enabled[0]);

  function move(e: KeyboardEvent<HTMLButtonElement>, from: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: SegmentedOption<T> | undefined;
    const pos = enabled.indexOf(options[from]);
    if (e.key in keys) {
      next = enabled[(pos + keys[e.key] + enabled.length) % enabled.length];
    } else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const idx = options.indexOf(next);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[idx]?.focus();
  }

  return (
    <div
      ref={group}
      className={['segmented', size === 'sm' ? 'small' : '', className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === tabStop ? 0 : -1}
          disabled={o.disabled}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={e => move(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

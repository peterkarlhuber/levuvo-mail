// Settings layout: cards (Section) with label/control rows (Row) and switches (Toggle).
// Used by Settings and by every other settings-like page (e.g. a space's settings tab),
// so they all share one look. Styles: styles/settings.css.
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

export function Section({
  title,
  children,
  description,
  level = 2,
  danger
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** Heading level: 2 in Settings, 3 where the page already has an h2 (e.g. a space's name). */
  level?: 2 | 3;
  /** Danger zone (irreversible actions): red frame, always the last section of a page. */
  danger?: boolean;
}) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <section className={danger ? 'settings-section settings-section--danger' : 'settings-section'}>
      <Heading className="settings-section-title">{title}</Heading>
      {description && <p className="settings-description">{description}</p>}
      {children}
    </section>
  );
}
export function Row({
  label,
  hint,
  wide,
  children
}: {
  label: string;
  hint?: string;
  /** Free-text field: placed below the label at full row width. */
  wide?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const control = useRef<HTMLDivElement>(null);
  // Fields inside a row get the row's label and hint as accessible name and description,
  // unless they carry their own (WCAG 1.3.1 / 4.1.2).
  useLayoutEffect(() => {
    const fields = [
      ...(control.current?.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea') ?? [])
    ];
    fields.forEach(el => {
      const named =
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') && !el.dataset.rowLabel) ||
        ((el as HTMLInputElement).labels?.length && !el.dataset.rowLabel);
      if (!named) {
        // A single field gets the row's visible <label>; several share it via aria-labelledby.
        if (fields.length === 1 && (!el.id || el.id === `${id}-field`)) el.id = `${id}-field`;
        else el.setAttribute('aria-labelledby', `${id}-label`);
        el.dataset.rowLabel = '1';
      }
      if (hint && !el.getAttribute('aria-describedby')) el.setAttribute('aria-describedby', `${id}-hint`);
    });
  });
  return (
    <div className={wide ? 'settings-row settings-row--wide' : 'settings-row'}>
      <div className="settings-row-label">
        <label id={`${id}-label`} htmlFor={`${id}-field`}>
          {label}
        </label>
        {hint && <small id={`${id}-hint`}>{hint}</small>}
      </div>
      <div className="settings-row-control" ref={control}>
        {children}
      </div>
    </div>
  );
}
export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

export type FieldProps = {
  label: ReactNode;
  /** Help text below the control, linked via aria-describedby. */
  hint?: ReactNode;
  /** Error text; marks the control aria-invalid and is announced. */
  error?: ReactNode;
  required?: boolean;
  /** Visually hides the label (it stays available to screen readers). */
  hideLabel?: boolean;
  className?: string;
  /** Exactly one control: input, select, textarea or a custom component that forwards props. */
  children: ReactElement<Record<string, unknown>>;
};

/** Label + control + hint + error with all ARIA wiring done once, correctly. */
export function Field({ label, hint, error, required, hideLabel, className, children }: FieldProps) {
  const auto = useId();
  const id = (isValidElement(children) && (children.props.id as string)) || `f${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [children.props['aria-describedby'] as string | undefined, hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required || undefined,
    required: required || (children.props.required as boolean | undefined)
  });
  return (
    <div className={['field', error ? 'has-error' : '', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'field-label sr-only' : 'field-label'}>
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Text that is only read by screen readers. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

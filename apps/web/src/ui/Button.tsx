import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'primary-danger' | 'ghost';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Icon before the label (lucide icon element). Decorative: hidden from screen readers. */
  icon?: ReactNode;
  /** Shows a busy state and blocks clicks; announced via aria-busy. */
  busy?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = {
  default: '',
  primary: 'primary',
  danger: 'danger',
  'primary-danger': 'primary danger',
  ghost: 'ghost'
};

/** Text button. Always has a visible label; use IconButton for icon-only actions. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, busy, className, children, type = 'button', disabled, ...rest },
  ref
) {
  const cls = ['btn', VARIANT[variant], size === 'sm' ? 'small' : '', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {icon && (
        <span className="btn-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
});

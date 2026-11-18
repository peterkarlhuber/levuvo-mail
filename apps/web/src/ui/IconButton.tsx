import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  /** Accessible name – required, icon-only buttons have no visible text. Also used as tooltip. */
  label: string;
  icon: ReactNode;
  /** Toggle buttons (star, flag …) report their state. */
  pressed?: boolean;
  size?: 'sm' | 'md';
};

/** Icon-only button with an enforced accessible name and a ≥ 24px (44px on touch) hit area. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, pressed, size = 'md', className, type = 'button', title, ...rest },
  ref
) {
  const cls = ['icon-button', size === 'sm' ? 'small' : '', className].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      {...rest}
    >
      <span aria-hidden="true" className="icon-button-glyph">
        {icon}
      </span>
    </button>
  );
});

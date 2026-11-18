import { useId, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useT } from '../i18n';
import { useFocusTrap } from './focus';

export type DialogProps = {
  /** Visible heading; also the accessible name. */
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  /** Short description below the title, linked via aria-describedby. */
  description?: ReactNode;
  /** Buttons row at the bottom (right aligned, primary action last). */
  footer?: ReactNode;
  /** sm 440px, md 560px, lg 760px. */
  size?: 'sm' | 'md' | 'lg';
  /** alertdialog for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
  /** Clicking the backdrop closes the dialog (default true; false for forms with unsaved input). */
  dismissible?: boolean;
  /** Renders the panel as a <form>; Enter submits. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  className?: string;
};

/**
 * Modal dialog: focus trap, focus return, Escape, labelled + described, rendered in a portal.
 * On narrow screens (≤ 640px) it becomes a bottom sheet automatically (CSS).
 */
export function Dialog({
  title,
  onClose,
  children,
  description,
  footer,
  size = 'md',
  role = 'dialog',
  dismissible = true,
  onSubmit,
  className
}: DialogProps) {
  const { t } = useT();
  const id = useId();
  const trap = useFocusTrap<HTMLDivElement>();
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  const body = (
    <>
      <header className="ui-dialog-header">
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Schließen')}
          title={t('Schließen')}
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      {description && (
        <p id={descId} className="ui-dialog-description">
          {description}
        </p>
      )}
      {children && <div className="ui-dialog-body">{children}</div>}
      {footer && <footer className="ui-dialog-footer">{footer}</footer>}
    </>
  );
  return createPortal(
    <div
      className="ui-dialog-scrim"
      role="presentation"
      onMouseDown={e => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trap}
        className={['ui-dialog', `ui-dialog-${size}`, className].filter(Boolean).join(' ')}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {onSubmit ? (
          <form
            className="ui-dialog-form"
            onSubmit={e => {
              e.preventDefault();
              onSubmit(e);
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>,
    document.body
  );
}

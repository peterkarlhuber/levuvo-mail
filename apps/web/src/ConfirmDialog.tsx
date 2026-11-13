import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useT } from './i18n';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
export type PromptOptions = {
  title: string;
  message?: string;
  label?: string;
  cancelLabel?: string;
  value?: string;
  type?: 'text' | 'password';
  confirmLabel?: string;
  validate?: (v: string) => string | null;
};
export type Toast = {
  id: number;
  text: string;
  kind?: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  timeout?: number;
  progress?: number;
};

type Pending =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (v: string | null) => void } & PromptOptions);

type UiApi = {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  toast: (t: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  updateToast: (id: number, patch: Partial<Toast>) => void;
};
const UiContext = createContext<UiApi>({
  confirm: async () => false,
  prompt: async () => null,
  toast: () => 0,
  dismiss: () => {},
  updateToast: () => {}
});

/** In-app dialogs and toasts (replaces window.confirm/prompt). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const primary = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ kind: 'confirm', ...o, resolve })),
    []
  );
  const prompt = useCallback(
    (o: PromptOptions) =>
      new Promise<string | null>(resolve => {
        setValue(o.value || '');
        setError('');
        setPending({ kind: 'prompt', ...o, resolve });
      }),
    []
  );
  const dismiss = useCallback((id: number) => setToasts(list => list.filter(x => x.id !== id)), []);
  const toast = useCallback(
    (tst: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts(list => [...list.slice(-3), { ...tst, id }]);
      if (tst.timeout !== 0) window.setTimeout(() => dismiss(id), tst.timeout || 5000);
      return id;
    },
    [dismiss]
  );
  const updateToast = useCallback(
    (id: number, patch: Partial<Toast>) => setToasts(list => list.map(x => (x.id === id ? { ...x, ...patch } : x))),
    []
  );

  useEffect(() => {
    if (pending?.kind === 'prompt') input.current?.focus();
    else if (pending) primary.current?.focus();
  }, [pending]);

  function close(ok: boolean) {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(ok);
    else {
      if (ok) {
        const problem = pending.validate?.(value) || null;
        if (problem) {
          setError(problem);
          return;
        }
        pending.resolve(value);
      } else pending.resolve(null);
    }
    setPending(null);
  }

  return (
    <UiContext.Provider value={{ confirm, prompt, toast, dismiss, updateToast }}>
      {children}
      {pending && (
        <div
          className="modal-scrim confirm-scrim"
          role="presentation"
          onMouseDown={e => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <form
            className="confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onSubmit={e => {
              e.preventDefault();
              close(true);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close(false);
              }
            }}
          >
            <h2 id="dialog-title">{pending.title}</h2>
            {pending.message && <p>{pending.message}</p>}
            {pending.kind === 'prompt' && (
              <label className="dialog-field">
                {pending.label}
                <input
                  ref={input}
                  type={pending.type || 'text'}
                  value={value}
                  onChange={e => {
                    setValue(e.target.value);
                    setError('');
                  }}
                  autoComplete="off"
                />
              </label>
            )}
            {error && (
              <p className="dialog-error" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => close(false)}>
                {pending.cancelLabel || t('Abbrechen')}
              </button>
              <button
                ref={primary}
                type="submit"
                className={pending.kind === 'confirm' && pending.danger ? 'btn primary danger' : 'btn primary'}
              >
                {pending.confirmLabel || t('OK')}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(x => (
          <div key={x.id} className={`toast ${x.kind || 'info'}`}>
            <span>{x.text}</span>
            {x.action && (
              <button
                className="toast-action"
                onClick={() => {
                  x.action!.run();
                  dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
            <button className="toast-close" aria-label={t('Schließen')} onClick={() => dismiss(x.id)}>
              <X size={14} />
            </button>
            {typeof x.progress === 'number' && (
              <span className="toast-progress" style={{ width: `${Math.max(0, Math.min(100, x.progress))}%` }} />
            )}
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

export const useUi = () => useContext(UiContext);
export const useConfirm = () => useContext(UiContext).confirm;

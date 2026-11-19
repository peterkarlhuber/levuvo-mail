// Error boundaries: an error while loading or showing one module (tasks, calendar, …) stays in
// that module. The rail and every other module keep working, and the user sees what happened
// instead of an empty (black) window. The root boundary catches whatever is left.
import { Component, lazy, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, RotateCcw } from 'lucide-react';
import { postJson } from './api';
import { browserRecoveryEnv, isChunkLoadError, loadWithRecovery } from './chunk-recovery';
import { resolveLang, translate, useT } from './i18n';
import { PREFS_KEY } from './prefs';

/** React.lazy with recovery from stale chunk names (see chunk-recovery.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same constraint as React.lazy
export function lazyModule<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => loadWithRecovery(factory, browserRecoveryEnv()));
}

/** Error code only, no content (the server records it when diagnostics are enabled). */
function report(name: string, error: unknown) {
  const kind = isChunkLoadError(error) ? 'chunk' : String((error as Error)?.name || 'error').slice(0, 30);
  void postJson('/api/diagnostics/client-error', { code: `ui.boundary.${name}.${kind}` }, 'mail-v1').catch(() => {});
}

type BoundaryProps = {
  name: string;
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
};

export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[Levuvo Mail] ${this.props.name}:`, error, info.componentStack);
    report(this.props.name, error);
  }
  reset = () => this.setState({ error: null });
  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

function ErrorPanel({
  title,
  text,
  error,
  retryLabel,
  reloadLabel,
  detailsLabel,
  onRetry
}: {
  title: string;
  text: string;
  error: Error;
  retryLabel: string;
  reloadLabel: string;
  detailsLabel: string;
  onRetry?: () => void;
}) {
  return (
    <div className="module-error" role="alert">
      <AlertTriangle size={26} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="module-error-actions">
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            <RotateCcw size={15} aria-hidden="true" /> {retryLabel}
          </button>
        )}
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          <RefreshCcw size={15} aria-hidden="true" /> {reloadLabel}
        </button>
      </div>
      <details className="module-error-details">
        <summary>{detailsLabel}</summary>
        <code>{`${error.name}: ${error.message}`.slice(0, 500)}</code>
      </details>
    </div>
  );
}

/** Boundary around one module; "try again" renders the module anew. */
export function ModuleBoundary({ name, children }: { name: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <ErrorBoundary
      name={name}
      fallback={(error, reset) => (
        <ErrorPanel
          title={t('Dieser Bereich konnte nicht angezeigt werden.')}
          text={
            isChunkLoadError(error)
              ? t('Ein Teil der App ließ sich nicht laden, meist nach einem Update. Neu laden behebt das.')
              : t('Die anderen Bereiche funktionieren weiter. Versuche es erneut oder lade die App neu.')
          }
          error={error}
          retryLabel={t('Erneut versuchen')}
          reloadLabel={t('App neu laden')}
          detailsLabel={t('Technische Details')}
          onRetry={reset}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

function storedLang() {
  try {
    const v = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') as { language?: string };
    return resolveLang(typeof v.language === 'string' ? v.language : '');
  } catch {
    return resolveLang('');
  }
}

/** Last line of defence around the whole app (no hooks or context of the app needed). */
export function RootBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      name="root"
      fallback={error => {
        const t = (text: string) => translate(storedLang(), text);
        return (
          <div className="root-error">
            <ErrorPanel
              title={t('Levuvo Mail konnte nicht angezeigt werden.')}
              text={t('Deine Daten sind davon nicht betroffen. Lade die App neu.')}
              error={error}
              retryLabel={t('Erneut versuchen')}
              reloadLabel={t('App neu laden')}
              detailsLabel={t('Technische Details')}
            />
          </div>
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

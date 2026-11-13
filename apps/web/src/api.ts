import { resolveLang, translate } from './i18n';
import { getPrefs } from './prefs';

// All requests go to the local Levuvo API on the same origin. Write requests carry
// an action header that a cross-site page cannot set without a CORS preflight.

export class ApiError extends Error {
  code?: string;
  field?: string;
  retryable?: boolean;
  status: number;
  constructor(message: string, status: number, extra: { code?: string; field?: string; retryable?: boolean } = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export function accountPath(path: string, accountId?: string) {
  if (!accountId) return path;
  return `${path}${path.includes('?') ? '&' : '?'}account=${encodeURIComponent(accountId)}`;
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  // Server messages are German; the English UI shows the translation where one exists.
  const message = translate(resolveLang(getPrefs().language), body?.error || fallback);
  if (!res.ok)
    throw new ApiError(message, res.status, { code: body?.code, field: body?.field, retryable: body?.retryable });
  return body as T;
}

export async function getJson<T>(path: string, accountId?: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(accountPath(path, accountId), { cache: 'no-store', signal });
  return parse<T>(res, 'Verbindung fehlgeschlagen.');
}

export type ActionKind =
  'mail-v1' | 'accounts-v1' | 'draft-v1' | 'send-v1' | 'calendar-v1' | 'contacts-v1' | 'crypto-v1';

export async function postJson<T>(path: string, body: unknown, action: ActionKind, accountId?: string): Promise<T> {
  const res = await fetch(accountPath(path, accountId), {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Levuvo-Action': action },
    body: JSON.stringify(body)
  });
  return parse<T>(res, 'Aktion fehlgeschlagen.');
}

export const postAction = <T>(path: string, body: unknown, accountId: string) =>
  postJson<T>(path, body, 'mail-v1', accountId);

export async function fileToBase64(file: Blob & { name?: string }): Promise<{ name: string; contentBase64: string }> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Datei ${file.name || ''} konnte nicht gelesen werden.`));
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({ name: file.name || 'datei', contentBase64: result.slice(result.indexOf(',') + 1) });
    };
    reader.readAsDataURL(file);
  });
}

export async function fileToDataUrl(file: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

/** Opens a download of a same-origin URL (the session cookie is sent automatically). */
export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

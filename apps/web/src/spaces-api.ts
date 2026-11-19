// Types and calls for shared spaces ("Räume").
import { ApiError, getJson, postJson } from './api';
import { resolveLang, translate } from './i18n';
import { getPrefs } from './prefs';

export type Role = 'owner' | 'editor' | 'reader';
export type SpaceSummary = {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'joining' | 'removed' | 'left' | 'dissolved';
  role: Role | null;
  owner: boolean;
  accountId: string;
  email: string;
  members: number;
  openTasks: number;
  updatedAt: string;
  pendingMails: number;
  sendError: string | null;
};
export type Invitation = {
  id: string;
  space: string;
  name: string;
  description: string;
  role: 'editor' | 'reader';
  email: string;
  expires: string;
  expired: boolean;
  from: { name: string; email: string };
  safetyCode: string;
  fromMismatch: boolean;
  accountId: string;
};
export type SpaceList = {
  identity: { id: string; safetyCode: string };
  updateNeeded?: boolean;
  spaces: SpaceSummary[];
  invitations: Invitation[];
};
export type Member = {
  id: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: string;
  removed: string | null;
  left: boolean;
  me: boolean;
  safetyCode: string;
};
export type Target = { kind: 'mail' | 'task' | 'event' | 'file' | 'note' | 'space'; id: string };
export type Note = {
  id: string;
  title: string;
  text: string;
  pinned: boolean;
  updatedAt: string;
  updatedBy: string;
  createdBy: string;
};
export type SpaceMail = {
  id: string;
  subject: string;
  from: { name: string; address: string } | null;
  to: { name: string; address: string }[];
  date: string | null;
  text: string;
  attachments: { name: string; size: number; file: string | null }[];
  addedAt: string;
  addedBy: string;
};
export type Comment = { id: string; target: Target; text: string; at: string; by: string; editedAt?: string };
export type Task = {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'doing' | 'done';
  priority: 'low' | 'normal' | 'high';
  due: string | null;
  assignee: string | null;
  createdBy: string;
  updatedAt: string;
};
export type SpaceEvent = {
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string;
  notes: string;
  attendees: string[];
};
export type SpaceFile = {
  id: string;
  name: string;
  folder: string;
  createdAt: string;
  createdBy: string;
  versions: { n: number; size: number; mime: string; at: string; by: string }[];
};
export type Activity = {
  op: string;
  at: string;
  by: string;
  type: string;
  target: Target;
  label: string;
  detail?: string;
};
export type SpaceDetail = SpaceSummary & {
  me: string;
  mySafetyCode: string;
  dissolved: boolean;
  ai: { enabled: boolean; cloudAllowed: boolean; instructions: string };
  members: Member[];
  invites: { email: string; role: 'editor' | 'reader'; expires: string; expired: boolean }[];
  notes: Note[];
  mails: SpaceMail[];
  comments: Comment[];
  tasks: Task[];
  events: SpaceEvent[];
  files: SpaceFile[];
  folders: string[];
  activity: Activity[];
};

const ACTION = 'spaces-v1';
export const spaces = {
  list: () => getJson<SpaceList>('/api/spaces'),
  detail: (id: string) => getJson<SpaceDetail>(`/api/spaces/${id}`),
  note: (id: string, note: string) => getJson<{ update: string; text: string }>(`/api/spaces/${id}/notes/${note}`),
  post: <T = { ok: boolean }>(path: string, body: unknown = {}) => postJson<T>(`/api/spaces${path}`, body, ACTION),
  op: (id: string, type: string, data: unknown) =>
    postJson<{ ok: boolean }>(`/api/spaces/${id}/op`, { type, data }, ACTION),
  async upload(id: string, file: File, { folder = '', fileId = '' } = {}) {
    const q = new URLSearchParams({ name: file.name, mime: file.type || 'application/octet-stream', folder });
    if (fileId) q.set('file', fileId);
    const res = await fetch(`/api/spaces/${id}/files/upload?${q}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Levuvo-Action': ACTION },
      body: file
    });
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new ApiError(
        translate(resolveLang(getPrefs().language), body?.error || 'Aktion fehlgeschlagen.'),
        res.status,
        {
          code: body?.code
        }
      );
    return body as { id: string };
  }
};

/** Random 128-bit hex ID for new items (the server checks the format). */
export function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

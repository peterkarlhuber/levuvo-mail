import { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Copy, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button, IconButton } from './ui';
import { Row, Section, Toggle } from './Settings';

type Level = 'read' | 'draft' | 'organize' | 'full';
type Agent = {
  id: string;
  name: string;
  level: Level;
  autoSend: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};
type McpState = {
  enabled: boolean;
  port: number;
  running: boolean;
  url: string;
  agents: Agent[];
  pending: number;
  bridge: unknown;
};
export type Approval = {
  id: string;
  agentName: string;
  type: 'send' | 'event' | 'contact' | 'trash' | 'room_change' | (string & {});
  summary: Record<string, unknown>;
  status: string;
  createdAt: string;
};

const LEVEL_LABELS: Record<Level, string> = {
  read: 'Nur lesen',
  draft: 'Lesen und Entwürfe',
  organize: 'Lesen, Entwürfe, Ordnen',
  full: 'Alles inkl. Senden'
};

export function approvalTitle(a: Approval, t: (s: string, v?: Record<string, string | number>) => string) {
  const s = a.summary as Record<string, string & string[]>;
  switch (a.type) {
    case 'send':
      return t('Nachricht an {to} senden: „{subject}“', { to: (s.to || []).join(', '), subject: s.subject || '' });
    case 'event':
      return t('Termin anlegen: „{summary}“ am {start}', { summary: s.summary || '', start: s.start || '' });
    case 'contact':
      return t('Kontakt speichern: {name}', { name: s.name || '' });
    case 'trash':
      return t('Nachricht in den Papierkorb verschieben');
    case 'room_change': {
      const v = { room: s.room || '', subject: s.subject || '' };
      const action: Record<string, string> = {
        create_room: t('Neuen Raum „{subject}“ anlegen', v),
        create_note: t('Notiz „{subject}“ anlegen', v),
        append_note: t('Notiz „{subject}“ ergänzen', { subject: s.subject || t('Ohne Titel') }),
        add_task: t('Aufgabe „{subject}“ anlegen', v),
        update_task: t('Aufgabe „{subject}“ ändern', v),
        add_event: t('Termin „{subject}“ eintragen', v),
        comment: t('Kommentar schreiben'),
        add_mail: t('Mail in den Raum legen'),
        invite: t('{subject} einladen', v),
        remove_member: t('{subject} entfernen', v),
        set_role: t('Rolle von {subject} ändern', v)
      };
      const text = action[s.kind];
      if (!text) return typeof a.summary?.title === 'string' ? a.summary.title : a.type;
      return s.kind === 'create_room' ? text : t('Raum „{room}“: {action}', { room: v.room, action: text });
    }
    default:
      return typeof a.summary?.title === 'string' ? a.summary.title : a.type;
  }
}

type Tr = (s: string, v?: Record<string, string | number>) => string;
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * Everything the approved action will do: every recipient and the sending account, the full text,
 * attendees, place and description, the message to be deleted, the content written into a space.
 * Nothing that matters may be hidden behind a shortened title.
 */
export function ApprovalDetails({ a, t }: { a: Approval; t: Tr }) {
  const s = a.summary || {};
  const rows: [string, string][] = [];
  const add = (label: string, value: string) => value && rows.push([label, value]);
  let body = '';
  let note = '';
  switch (a.type) {
    case 'send':
      add(t('Von'), text(s.from));
      add(t('An'), list(s.to).join(', '));
      add(t('Kopie (CC)'), list(s.cc).join(', '));
      add(t('Betreff'), text(s.subject));
      body = text(s.text);
      break;
    case 'event':
      add(t('Beginn'), text(s.start));
      add(t('Ende'), text(s.end));
      add(t('Ort'), text(s.location));
      add(t('Teilnehmende'), list(s.attendees).join(', '));
      body = text(s.description);
      if (list(s.attendees).length) note = t('Es werden keine Einladungen verschickt.');
      break;
    case 'contact':
      add(t('E-Mail'), list(s.emails).join(', '));
      add(t('Telefon'), list(s.phones).join(', '));
      break;
    case 'trash':
      add(t('Absender'), text(s.sender));
      add(t('Betreff'), text(s.subject));
      add(t('Ordner'), text(s.folder));
      add(t('Konto'), text(s.from));
      break;
    case 'room_change': {
      const c = (s.content && typeof s.content === 'object' ? s.content : {}) as Record<string, unknown>;
      const labels: Record<string, string> = {
        name: t('Name'),
        title: t('Titel'),
        email: t('E-Mail'),
        role: t('Rolle'),
        due: t('Fällig'),
        start: t('Beginn'),
        location: t('Ort'),
        folder: t('Ordner'),
        account: t('Konto')
      };
      for (const [key, label] of Object.entries(labels)) add(label, text(c[key]));
      body = [c.description, c.notes, c.text].map(text).filter(Boolean).join('\n\n');
      break;
    }
    default:
      break;
  }
  if (!rows.length && !body && !note) return null;
  return (
    <>
      {rows.length > 0 && (
        <dl className="ai-approval-fields">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {body && (
        <pre className="ai-approval-text" tabIndex={0} aria-label={t('Vollständiger Text')}>
          {body}
        </pre>
      )}
      {note && <small>{note}</small>}
    </>
  );
}

export function ApprovalList({ onChange }: { onChange?: () => void }) {
  const { t } = useT();
  const { toast } = useUi();
  const [items, setItems] = useState<Approval[]>([]);
  const load = useCallback(
    () =>
      getJson<{ pending: Approval[] }>('/api/mcp/approvals')
        .then(r => setItems(r.pending))
        .catch(() => {}),
    []
  );
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  async function decide(id: string, approve: boolean) {
    try {
      const r = await postJson<{ status: string }>('/api/mcp/approvals/decide', { id, approve }, 'ai-v1');
      toast({
        text:
          r.status === 'approved'
            ? t('Freigegeben und ausgeführt.')
            : r.status === 'rejected'
              ? t('Abgelehnt.')
              : t('Ausführung fehlgeschlagen.'),
        kind: r.status === 'failed' ? 'error' : 'success'
      });
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    }
    void load();
    onChange?.();
  }
  if (!items.length) return <small>{t('Keine offenen Freigaben.')}</small>;
  return (
    <div className="ai-approvals">
      {items.map(a => (
        <div className="ai-approval" key={a.id}>
          <div>
            <strong>{approvalTitle(a, t)}</strong>
            <small>{t('Vorgeschlagen von {agent}', { agent: a.agentName })}</small>
            <ApprovalDetails a={a} t={t} />
          </div>
          <div className="settings-actions">
            <Button
              size="sm"
              variant="primary"
              icon={<Check size={14} />}
              aria-label={t('Freigeben: {title}', { title: approvalTitle(a, t) })}
              onClick={() => void decide(a.id, true)}
            >
              {t('Freigeben')}
            </Button>
            <Button
              size="sm"
              icon={<X size={14} />}
              aria-label={t('Ablehnen: {title}', { title: approvalTitle(a, t) })}
              onClick={() => void decide(a.id, false)}
            >
              {t('Ablehnen')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function McpSettings() {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [state, setState] = useState<McpState | null>(null);
  const [name, setName] = useState('');
  const [level, setLevel] = useState<Level>('draft');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const load = useCallback(
    () =>
      getJson<McpState>('/api/mcp')
        .then(setState)
        .catch(() => setState(null)),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);
  const post = async (path: string, body: unknown) => {
    try {
      return await postJson<McpState & { token?: string; state?: McpState }>(path, body, 'ai-v1');
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
      return null;
    }
  };
  if (!state) return null;
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(() => toast({ text: t('Kopiert.'), kind: 'info' }));
  const desktopConfig = created ? JSON.stringify(state.bridge, null, 2).replace('<TOKEN>', created.token) : '';
  const httpCommand = created
    ? `claude mcp add --transport http levuvo-mail ${state.url} --header "Authorization: Bearer ${created.token}"`
    : '';
  return (
    <>
      <Section
        title={t('Agenten-Schnittstelle (MCP)')}
        description={t(
          'Externe KI-Agenten wie Claude Desktop, Cursor oder ChatGPT Desktop können Levuvo Mail über das Model Context Protocol bedienen. Nur auf diesem Computer erreichbar, jeder Agent mit eigenem Zugangsschlüssel und eigener Berechtigung. Senden, Einladungen und Papierkorb brauchen deine Freigabe.'
        )}
      >
        <Row label={t('MCP-Server')} hint={state.running ? t('Läuft auf {url}', { url: state.url }) : t('Aus')}>
          <Toggle
            label={t('MCP-Server')}
            checked={state.enabled}
            onChange={async v => {
              const next = await post('/api/mcp/settings', { enabled: v });
              if (next) setState(next);
            }}
          />
        </Row>
        <Row label={t('Port')}>
          <input
            type="number"
            min={1024}
            max={65535}
            defaultValue={state.port}
            onBlur={async e => {
              const port = Number(e.target.value);
              if (port !== state.port) {
                const next = await post('/api/mcp/settings', { port });
                if (next) setState(next);
              }
            }}
          />
        </Row>
        {state.agents.map(a => (
          <Row
            key={a.id}
            label={a.name}
            hint={
              a.lastUsedAt
                ? t('Zuletzt verwendet {time}', {
                    time: new Date(a.lastUsedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
                  })
                : t('Noch nicht verwendet')
            }
          >
            <select
              value={a.level}
              onChange={async e => {
                const next = await post('/api/mcp/agents/update', { id: a.id, level: e.target.value });
                if (next) setState(next);
              }}
            >
              {(Object.keys(LEVEL_LABELS) as Level[]).map(l => (
                <option key={l} value={l}>
                  {t(LEVEL_LABELS[l])}
                </option>
              ))}
            </select>
            {a.level === 'full' && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={a.autoSend}
                  onChange={async e => {
                    if (
                      e.target.checked &&
                      !(await confirm({
                        title: t('Ohne Freigabe senden?'),
                        message: t(
                          '{name} kann dann Nachrichten in deinem Namen senden, ohne dass du sie vorher siehst. Nur für Agenten, denen du voll vertraust.',
                          { name: a.name }
                        ),
                        confirmLabel: t('Erlauben'),
                        danger: true
                      }))
                    )
                      return;
                    const next = await post('/api/mcp/agents/update', { id: a.id, autoSend: e.target.checked });
                    if (next) setState(next);
                  }}
                />{' '}
                {t('ohne Freigabe senden')}
              </label>
            )}
            <IconButton
              label={t('Zugang entfernen')}
              icon={<Trash2 size={16} />}
              onClick={async () => {
                if (
                  await confirm({
                    title: t('Zugang von {name} entfernen?', { name: a.name }),
                    confirmLabel: t('Entfernen'),
                    danger: true
                  })
                ) {
                  const next = await post('/api/mcp/agents/remove', { id: a.id });
                  if (next) setState(next);
                }
              }}
            />
          </Row>
        ))}
        <Row label={t('Neuer Agent')} hint={t('Der Zugangsschlüssel wird nur einmal angezeigt.')}>
          <input
            aria-label={t('Name des Agenten')}
            placeholder={t('z. B. Claude Desktop')}
            value={name}
            maxLength={60}
            onChange={e => setName(e.target.value)}
          />
          <select aria-label={t('Rechte des Agenten')} value={level} onChange={e => setLevel(e.target.value as Level)}>
            {(Object.keys(LEVEL_LABELS) as Level[]).map(l => (
              <option key={l} value={l}>
                {t(LEVEL_LABELS[l])}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            icon={<Plus size={14} />}
            disabled={!name.trim()}
            onClick={async () => {
              const r = await post('/api/mcp/agents/create', { name, level });
              if (r?.token && r.state) {
                setCreated({ name, token: r.token });
                setState(r.state);
                setName('');
              }
            }}
          >
            {t('Zugang erstellen')}
          </Button>
        </Row>
        {created && (
          <div className="ai-token">
            <p>
              <KeyRound size={14} />{' '}
              {t('Zugang für {name} erstellt. Diese Angaben jetzt in den Agenten übernehmen:', { name: created.name })}
            </p>
            <small>{t('Claude Desktop und andere Programme mit Befehl (claude_desktop_config.json):')}</small>
            <pre>{desktopConfig}</pre>
            <Button size="sm" icon={<Copy size={14} />} onClick={() => copy(desktopConfig)}>
              {t('Kopieren')}
            </Button>
            <small>{t('Claude Code und andere Programme mit HTTP-Unterstützung:')}</small>
            <pre>{httpCommand}</pre>
            <Button size="sm" icon={<Copy size={14} />} onClick={() => copy(httpCommand)}>
              {t('Kopieren')}
            </Button>
            <Button size="sm" onClick={() => setCreated(null)}>
              {t('Fertig')}
            </Button>
          </div>
        )}
      </Section>
      <Section title={t('Freigaben')} description={t('Was Agenten vorbereitet haben und auf deine Zustimmung wartet.')}>
        <ApprovalList onChange={load} />
      </Section>
      {state.agents.length === 0 && (
        <p className="settings-description">
          <Bot size={14} /> {t('Noch kein externer Agent eingerichtet.')}
        </p>
      )}
    </>
  );
}

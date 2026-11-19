import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { getJson } from './api';
import { useT } from './i18n';

/** The user manual (docs/manual) inside the app: chapter list, search and the chapter text. */
type Chapter = { id: string; number: number | null; title: string; markdown: string };
export type ManualTarget = { chapterId: string; section?: string };

const OPEN_EVENT = 'levuvo:manual';
let pending: ManualTarget | null = null;
/** Opens the manual at a chapter or section (from the assistant's answer sources). */
export function openManualAt(target: ManualTarget) {
  pending = target;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: target }));
}

const KEYS = new Set(['Strg', 'Ctrl', 'Enter', 'Entf', 'Delete', 'Del', 'Esc', 'Alt', 'Shift', '⌘', 'Tab']);

function inline(src: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  let n = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k}>{inline(m[2], k)}</em>);
    else if (m[3] !== undefined)
      out.push(KEYS.has(m[3]) || m[3].length <= 2 ? <kbd key={k}>{m[3]}</kbd> : <code key={k}>{m[3]}</code>);
    else
      out.push(
        <a key={k} href={m[5]} target="_blank" rel="noreferrer noopener">
          {m[4]}
        </a>
      );
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Renders the manual's Markdown subset (see scripts/manual/markdown-to-typst.mjs) as elements. */
function renderChapter(chapter: Chapter, lang: string, alt: (s: string) => string): ReactNode[] {
  const lines = chapter.markdown.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let section = 0;
  let i = 0;
  let para: string[] = [];
  const k = () => `b${out.length}`;
  const flush = () => {
    if (para.length) out.push(<p key={k()}>{inline(para.join(' '), k())}</p>);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    if (!line.trim() || /^:::|^\{\{/.test(line.trim())) {
      flush();
      i++;
    } else if ((m = /^(#{1,3}) (.+)$/.exec(line))) {
      flush();
      const level = m[1].length;
      if (level === 1) {
        i++;
        continue; // The chapter title is shown above.
      }
      if (level === 2) section++;
      const number = level === 2 && chapter.number ? `${chapter.number}.${section}` : '';
      const Tag = level === 2 ? 'h4' : 'h5';
      out.push(
        <Tag key={k()} id={`manual-${chapter.id}-${number || slug(m[2])}`} data-section={number || undefined}>
          {number && <span className="manual-number">{number}</span>}
          {inline(m[2], k())}
        </Tag>
      );
      i++;
    } else if ((m = /^!\[([^\]]+)\]\(([a-z0-9-]+\.png)\)$/.exec(line.trim()))) {
      flush();
      out.push(
        <figure key={k()} className="manual-figure">
          <img src={`/api/manual/img/${lang}/${m[2]}`} alt={alt(m[1])} loading="lazy" />
          <figcaption>{m[1]}</figcaption>
        </figure>
      );
      i++;
    } else if (line.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|\s*:?-{3}/.test(lines[i]))
          rows.push(
            lines[i]
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map(c => c.trim())
          );
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={k()} className="manual-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} scope="col">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, j) => (
                <tr key={j}>
                  {r.map((c, l) => (
                    <td key={l}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (line.startsWith('>')) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      const text = quote.join(' ');
      const warn = /^\*\*(Wichtig|Important)/.test(text);
      out.push(
        <aside key={k()} className={`manual-callout ${warn ? 'warn' : ''}`}>
          {inline(text, k())}
        </aside>
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      flush();
      const ordered = /^\d+\. /.test(line);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length && lines[i].trim() && /^(\s*)(- |\d+\. )/.test(lines[i])) {
        const it = /^(\s*)(- |\d+\. )(.*)$/.exec(lines[i]) as RegExpExecArray;
        if (it[1].length >= 2 && items.length) items[items.length - 1].sub.push(it[3]);
        else items.push({ text: it[3], sub: [] });
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={k()}>
          {items.map((it, j) => (
            <li key={j}>
              {inline(it.text)}
              {it.sub.length > 0 && (
                <ul>
                  {it.sub.map((s, l) => (
                    <li key={l}>{inline(s)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </List>
      );
    } else {
      para.push(line.trim());
      i++;
    }
  }
  flush();
  return out;
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function ManualView() {
  const { t, lang } = useT();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<ManualTarget | null>(() => pending);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getJson<{ chapters: Chapter[] }>(`/api/manual?lang=${lang === 'en' ? 'en' : 'de'}`)
      .then(r => alive && setChapters(r.chapters || []))
      .catch(e => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [lang]);
  useEffect(() => {
    const on = (e: Event) => setTarget((e as CustomEvent<ManualTarget>).detail);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  useEffect(() => {
    if (!target || !chapters) return;
    pending = null;
    setQuery('');
    setCurrent(target.chapterId);
    const id = `manual-${target.chapterId}-${target.section || ''}`;
    requestAnimationFrame(() => {
      const el = target.section ? document.getElementById(id) : body.current;
      el?.scrollIntoView({ block: 'start' });
      setTarget(null);
    });
  }, [target, chapters]);

  const chapter = chapters?.find(c => c.id === current) || chapters?.[0] || null;
  const hits = useMemo(() => {
    const q = fold(query.trim());
    if (!q || !chapters) return null;
    return chapters.flatMap(c =>
      c.markdown
        .split(/^(?=## )/m)
        .slice(1)
        .map((part, i) => ({ c, i, title: /^## (.+)$/m.exec(part)?.[1] || '', part }))
        .filter(s => fold(s.part).includes(q))
        .map(s => ({ chapterId: s.c.id, section: s.c.number ? `${s.c.number}.${s.i + 1}` : '', title: s.title }))
    );
  }, [query, chapters]);

  if (error) return <p className="settings-description">{error}</p>;
  if (!chapters) return null;
  if (!chapters.length)
    return <p className="settings-description">{t('Das Handbuch ist in dieser Version nicht enthalten.')}</p>;
  return (
    <div className="manual">
      <nav className="manual-nav" aria-label={t('Kapitel des Handbuchs')}>
        <label className="manual-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('Im Handbuch suchen')}
            aria-label={t('Im Handbuch suchen')}
          />
        </label>
        {hits ? (
          <ul>
            {hits.length === 0 && <li className="muted">{t('Nichts gefunden.')}</li>}
            {hits.map(h => (
              <li key={`${h.chapterId}:${h.section}:${h.title}`}>
                <button
                  className="manual-link"
                  onClick={() => setTarget({ chapterId: h.chapterId, section: h.section })}
                >
                  {h.section && <span className="manual-number">{h.section}</span>}
                  {h.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul>
            {chapters.map(c => (
              <li key={c.id}>
                <button
                  className={`manual-link ${chapter?.id === c.id ? 'active' : ''}`}
                  aria-current={chapter?.id === c.id ? 'page' : undefined}
                  onClick={() => setTarget({ chapterId: c.id })}
                >
                  {c.number && <span className="manual-number">{c.number}</span>}
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      {chapter && (
        <article className="manual-body" ref={body} tabIndex={-1}>
          <h3>
            {chapter.number && <span className="manual-number">{chapter.number}</span>}
            {chapter.title}
          </h3>
          {renderChapter(chapter, lang === 'en' ? 'en' : 'de', s => s).map((n, i) => (
            <Fragment key={i}>{n}</Fragment>
          ))}
        </article>
      )}
    </div>
  );
}

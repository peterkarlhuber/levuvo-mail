// A note of a shared space, edited by several people at once. The document is a Yjs CRDT: local
// changes are sent as small updates, remote ones merge in without conflicts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { Bold, CheckSquare, Heading2, Italic, List, ListOrdered } from 'lucide-react';
import { spaces } from './spaces-api';
import { useT } from './i18n';

const REMOTE = 'remote';
const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string) => Uint8Array.from(atob(b), c => c.charCodeAt(0));

export default function SpaceNoteEditor({
  spaceId,
  noteId,
  readOnly
}: {
  spaceId: string;
  noteId: string;
  readOnly: boolean;
}) {
  const { t } = useT();
  const doc = useMemo(() => new Y.Doc(), []);
  const pending = useRef<Uint8Array[]>([]);
  const timer = useRef<number | null>(null);
  const [state, setState] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');

  const flush = useRef(async () => {});
  flush.current = async () => {
    if (!pending.current.length) return;
    const update = Y.mergeUpdates(pending.current);
    pending.current = [];
    setState('saving');
    try {
      await spaces.post(`/${spaceId}/notes/${noteId}/edit`, { update: toB64(update) });
      setState('saved');
    } catch {
      // Keep the change for the next attempt.
      pending.current.unshift(update);
      setState('error');
    }
  };

  useEffect(() => {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE || readOnly) return;
      pending.current.push(update);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush.current(), 1200);
    };
    doc.on('update', onUpdate);
    let alive = true;
    const pull = async () => {
      try {
        const r = await spaces.note(spaceId, noteId);
        if (alive) {
          Y.applyUpdate(doc, fromB64(r.update), REMOTE);
          setState(s => (s === 'loading' ? 'saved' : s));
        }
      } catch {
        if (alive) setState(s => (s === 'loading' ? 'error' : s));
      }
    };
    void pull();
    const poll = window.setInterval(() => void pull(), 5000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      doc.off('update', onUpdate);
      if (timer.current) window.clearTimeout(timer.current);
      void flush.current();
    };
  }, [doc, spaceId, noteId, readOnly]);
  useEffect(() => () => doc.destroy(), [doc]);

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({ document: doc })
      ],
      editorProps: { attributes: { class: 'space-note-body', 'aria-label': t('Notiz') } }
    },
    [doc, readOnly]
  );

  return (
    <div className="space-note">
      {!readOnly && editor && (
        <div className="space-note-tools" role="toolbar" aria-label={t('Formatierung')}>
          <button
            className={editor.isActive('bold') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label={t('Fett')}
          >
            <Bold size={15} />
          </button>
          <button
            className={editor.isActive('italic') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label={t('Kursiv')}
          >
            <Italic size={15} />
          </button>
          <button
            className={editor.isActive('heading') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            aria-label={t('Überschrift')}
          >
            <Heading2 size={15} />
          </button>
          <button
            className={editor.isActive('bulletList') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            aria-label={t('Aufzählung')}
          >
            <List size={15} />
          </button>
          <button
            className={editor.isActive('orderedList') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            aria-label={t('Nummerierung')}
          >
            <ListOrdered size={15} />
          </button>
          <button
            className={editor.isActive('taskList') ? 'active' : ''}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            aria-label={t('Checkliste')}
          >
            <CheckSquare size={15} />
          </button>
          <span className="space-note-state muted">
            {state === 'saving'
              ? t('Wird gespeichert …')
              : state === 'error'
                ? t('Nicht gespeichert, neuer Versuch folgt')
                : state === 'saved'
                  ? t('Gespeichert')
                  : ''}
          </span>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

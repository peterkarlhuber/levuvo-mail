import { generateHTML, generateJSON, useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import {
  Bold,
  Code2,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';

// Shared rich-text setup for the composer and the signature editor.
export const EXTENSIONS = [
  StarterKit.configure({
    link: { openOnClick: false, autolink: true, protocols: ['mailto'], HTMLAttributes: { rel: 'noopener' } },
    heading: { levels: [1, 2, 3] }
  }),
  Image.configure({ allowBase64: true, inline: false })
];
/** Signature HTML as the editor will serialize it (needed to find it again). */
export const normalize = (html: string) => {
  if (!html) return '';
  try {
    return generateHTML(generateJSON(html, EXTENSIONS), EXTENSIONS);
  } catch {
    return html;
  }
};
export const SIGNATURE_SEPARATOR = '<p>-- </p>';

export const htmlToPlain = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,h1,h2,h3,blockquote').forEach(n => n.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
};
export const plainToHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map(
      p =>
        `<p>${p.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/\n/g, '<br>')}</p>`
    )
    .join('');

export function Toolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const { t } = useT();
  const { prompt } = useUi();
  const b = (label: string, icon: ReactNode, run: () => void, active = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={active ? 'active' : ''}
      onMouseDown={e => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className="format-toolbar" role="toolbar" aria-label={t('Formatierung')}>
      {b(t('Fett'), <Bold size={15} />, () => chain().toggleBold().run(), editor.isActive('bold'))}
      {b(t('Kursiv'), <Italic size={15} />, () => chain().toggleItalic().run(), editor.isActive('italic'))}
      {b(
        t('Unterstrichen'),
        <Underline size={15} />,
        () => chain().toggleUnderline().run(),
        editor.isActive('underline')
      )}
      {b(
        t('Durchgestrichen'),
        <Strikethrough size={15} />,
        () => chain().toggleStrike().run(),
        editor.isActive('strike')
      )}
      <span className="sep" />
      {b(
        t('Überschrift'),
        <Heading2 size={15} />,
        () => chain().toggleHeading({ level: 2 }).run(),
        editor.isActive('heading')
      )}
      {b(t('Aufzählung'), <List size={15} />, () => chain().toggleBulletList().run(), editor.isActive('bulletList'))}
      {b(
        t('Nummerierung'),
        <ListOrdered size={15} />,
        () => chain().toggleOrderedList().run(),
        editor.isActive('orderedList')
      )}
      {b(t('Zitat'), <Quote size={15} />, () => chain().toggleBlockquote().run(), editor.isActive('blockquote'))}
      {b(t('Code'), <Code2 size={15} />, () => chain().toggleCode().run(), editor.isActive('code'))}
      <span className="sep" />
      {b(
        t('Link'),
        <Link2 size={15} />,
        async () => {
          const current = editor.getAttributes('link').href || 'https://';
          const href = await prompt({
            title: t('Link einfügen'),
            label: t('Adresse'),
            value: current,
            confirmLabel: t('Übernehmen'),
            validate: v =>
              !v || /^(https?:\/\/|mailto:)\S+$/i.test(v.trim())
                ? null
                : t('Nur https://, http:// oder mailto: erlaubt.')
          });
          if (href === null) return;
          if (!href.trim()) chain().unsetLink().run();
          else if (editor.state.selection.empty)
            chain()
              .insertContent(`<a href="${href.trim().replace(/"/g, '%22')}">${href.trim().replace(/</g, '&lt;')}</a>`)
              .run();
          else chain().setLink({ href: href.trim() }).run();
        },
        editor.isActive('link')
      )}
      {b(t('Bild einfügen'), <ImagePlus size={15} />, onImage)}
      {b(t('Formatierung entfernen'), <RemoveFormatting size={15} />, () => chain().unsetAllMarks().clearNodes().run())}
      <span className="sep" />
      {b(t('Rückgängig'), <Undo2 size={15} />, () => chain().undo().run())}
      {b(t('Wiederholen'), <Redo2 size={15} />, () => chain().redo().run())}
    </div>
  );
}

/** Small rich-text field (signatures): bold/links/images, value as HTML. */
export function RichTextField({
  value,
  onChange,
  label,
  maxImageBytes = 200 * 1024
}: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  maxImageBytes?: number;
}) {
  const { t } = useT();
  const { toast } = useUi();
  const input = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value || '',
    editorProps: { attributes: { class: 'compose-editor signature-editor', 'aria-label': label } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : e.getHTML())
  });
  async function insert(file?: File) {
    if (!file || !editor) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      toast({ text: t('Nur PNG, JPEG, GIF oder WebP.'), kind: 'error' });
      return;
    }
    if (file.size > maxImageBytes) {
      toast({
        text: t('Logo bitte unter {size} KB (wird in jede E-Mail eingebettet).', {
          size: Math.round(maxImageBytes / 1024)
        }),
        kind: 'error'
      });
      return;
    }
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    editor
      .chain()
      .focus()
      .setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, '') })
      .run();
  }
  if (!editor) return null;
  return (
    <div className="rich-field">
      <Toolbar editor={editor} onImage={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={e => {
          void insert(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <EditorContent editor={editor} className="compose-editor-wrap" />
    </div>
  );
}

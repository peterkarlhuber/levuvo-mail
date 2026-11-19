// Drag handle between message list and reader (pointer, arrow keys, double click resets).
// Split out of MailInstance (ARC-LEV-005).
import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { useT } from '../i18n';

export const LIST_WIDTH = { min: 300, max: 680, initial: 400, step: 20 };
export const clampListWidth = (width: number) => Math.max(LIST_WIDTH.min, Math.min(LIST_WIDTH.max, Math.round(width)));

type Props = {
  width: number;
  /** While dragging (not saved yet). */
  onResize: (width: number) => void;
  /** Final width, saved in the preferences. */
  onCommit: (width: number) => void;
};

export default function ColumnResizer({ width, onResize, onCommit }: Props) {
  const { t } = useT();
  const anchor = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="column-resizer"
      role="separator"
      aria-label={t('Listenbreite ändern')}
      aria-orientation="vertical"
      aria-valuemin={LIST_WIDTH.min}
      aria-valuemax={LIST_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title={t('Ziehen oder Pfeiltasten · Doppelklick setzt zurück')}
      onPointerDown={e => {
        if (e.button !== 0) return;
        anchor.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        if (anchor.current) onResize(clampListWidth(anchor.current.width + e.clientX - anchor.current.x));
      }}
      onPointerUp={e => {
        anchor.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        onCommit(width);
      }}
      onPointerCancel={() => {
        anchor.current = null;
      }}
      onDoubleClick={() => {
        onResize(LIST_WIDTH.initial);
        onCommit(LIST_WIDTH.initial);
      }}
      onKeyDown={e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        e.stopPropagation();
        const next = clampListWidth(width + (e.key === 'ArrowRight' ? LIST_WIDTH.step : -LIST_WIDTH.step));
        onResize(next);
        onCommit(next);
      }}
    >
      <GripVertical size={14} />
    </div>
  );
}

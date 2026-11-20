// Drag handle on the left edge of the Levuvo Mail Assistant panel: drag with the mouse or a finger,
// arrow keys / Home / End on the keyboard, double click resets the width. An ARIA separator (WCAG 2.1.1, 4.1.2).
import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { useT } from './i18n';
import { ASSISTANT_WIDTH, assistantWidthForKey, clampAssistantWidth, maxAssistantWidth } from './assistant-width';

type Props = {
  width: number;
  /** While dragging (not saved yet). */
  onResize: (width: number) => void;
  /** Final width, saved in the preferences. */
  onCommit: (width: number) => void;
};

export function AssistantResizer({ width, onResize, onCommit }: Props) {
  const { t } = useT();
  const anchor = useRef<{ x: number; width: number } | null>(null);
  const viewport = () => window.innerWidth;
  return (
    <div
      className="assistant-resizer"
      role="separator"
      aria-label={t('Breite des Assistenten ändern')}
      aria-controls="assistant-panel"
      aria-orientation="vertical"
      aria-valuemin={ASSISTANT_WIDTH.min}
      aria-valuemax={maxAssistantWidth(viewport())}
      aria-valuenow={width}
      aria-valuetext={t('{n} Pixel breit', { n: width })}
      tabIndex={0}
      title={t('Ziehen oder Pfeiltasten · Doppelklick setzt zurück')}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        anchor.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        // The handle is on the left edge: moving the pointer to the left makes the panel wider.
        if (anchor.current)
          onResize(clampAssistantWidth(anchor.current.width + anchor.current.x - e.clientX, viewport()));
      }}
      onPointerUp={e => {
        if (!anchor.current) return;
        anchor.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        onCommit(width);
      }}
      onPointerCancel={() => {
        anchor.current = null;
      }}
      onDoubleClick={() => {
        const reset = clampAssistantWidth(ASSISTANT_WIDTH.initial, viewport());
        onResize(reset);
        onCommit(reset);
      }}
      onKeyDown={e => {
        const next = assistantWidthForKey(e.key, width, viewport(), e.shiftKey);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        onResize(next);
        onCommit(next);
      }}
    >
      <GripVertical size={14} aria-hidden="true" />
    </div>
  );
}

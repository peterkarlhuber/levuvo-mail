// Width of the Levuvo Mail Assistant panel: limits, clamping and the keyboard steps of its drag handle.
// Pure functions, so they can be tested without a browser.

export const ASSISTANT_WIDTH = { min: 340, max: 960, initial: 420, step: 20, bigStep: 100 };
/** Space that always stays visible next to the panel, so the app behind it is not covered completely. */
export const ASSISTANT_KEEP_VISIBLE = 160;

/** Largest width the window allows right now (never below the minimum). */
export function maxAssistantWidth(viewport: number): number {
  return Math.max(ASSISTANT_WIDTH.min, Math.min(ASSISTANT_WIDTH.max, Math.floor(viewport - ASSISTANT_KEEP_VISIBLE)));
}

export function clampAssistantWidth(width: number, viewport = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(width)) return ASSISTANT_WIDTH.initial;
  return Math.max(ASSISTANT_WIDTH.min, Math.min(maxAssistantWidth(viewport), Math.round(width)));
}

/** A stored value is only taken over when it lies within the limits. */
export const validAssistantWidth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= ASSISTANT_WIDTH.min && value <= ASSISTANT_WIDTH.max;

/**
 * New width for a key on the handle, or null if the key does nothing. The handle sits on the left edge
 * of a panel docked to the right: ArrowLeft makes it wider, ArrowRight narrower (Shift: bigger steps),
 * Home the narrowest, End the widest width.
 */
export function assistantWidthForKey(key: string, width: number, viewport: number, shift = false): number | null {
  const step = shift ? ASSISTANT_WIDTH.bigStep : ASSISTANT_WIDTH.step;
  switch (key) {
    case 'ArrowLeft':
      return clampAssistantWidth(width + step, viewport);
    case 'ArrowRight':
      return clampAssistantWidth(width - step, viewport);
    case 'Home':
      return ASSISTANT_WIDTH.min;
    case 'End':
      return maxAssistantWidth(viewport);
    default:
      return null;
  }
}

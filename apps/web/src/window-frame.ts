/**
 * The desktop app has no separate system title bar (see apps/desktop/main.mjs): on macOS the
 * traffic lights sit in the rail, on Windows the window buttons are drawn over the top right
 * corner. The page marks the document so styles/window-frame.css can make room and declare
 * the areas that move the window. Browsers keep their normal layout.
 */
export type WindowFrame = 'mac' | 'win' | null;

export function detectWindowFrame(userAgent: string): WindowFrame {
  if (!/\bElectron\//.test(userAgent)) return null;
  if (/\bMacintosh\b|\bMac OS X\b/.test(userAgent)) return 'mac';
  if (/\bWindows\b/.test(userAgent)) return 'win';
  return null;
}

export function applyWindowFrame(root: HTMLElement, userAgent: string) {
  const frame = detectWindowFrame(userAgent);
  if (frame) root.dataset.windowFrame = frame;
  else delete root.dataset.windowFrame;
  return frame;
}

// Window frame without a separate system title bar. macOS keeps the traffic lights inside the
// app's rail ("hidden" with a custom position), Windows draws minimize/maximize/close over the top right corner in
// the app's colours (titleBarOverlay). Heights and the reserved width must match the tokens
// --titlebar-h-mac, --titlebar-h-win and --window-controls-w (apps/web/src/styles/tokens.css).
// Linux keeps the normal system frame.

export const MAC_TITLEBAR_HEIGHT = 28;
export const WIN_TITLEBAR_HEIGHT = 32;
// Centred in the 72 px rail, in the middle of the 28 px strip.
export const MAC_TRAFFIC_LIGHTS = { x: 10, y: 8 };

const THEME = {
  dark: { color: '#0b0b0b', symbolColor: '#f2f2f2' },
  light: { color: '#ffffff', symbolColor: '#141414' }
};

/** Normalises a page theme colour (<meta name="theme-color">) to "dark" or "light". */
export function themeFromColor(color, fallbackDark = true) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || '').trim());
  if (!m) return fallbackDark ? 'dark' : 'light';
  const n = parseInt(m[1], 16);
  const luminance = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luminance < 128 ? 'dark' : 'light';
}

export function titleBarOverlay(theme) {
  return { ...THEME[theme === 'light' ? 'light' : 'dark'], height: WIN_TITLEBAR_HEIGHT };
}

/** BrowserWindow options for the frame on this platform. */
export function windowFrameOptions(platform, dark) {
  if (platform === 'darwin') return { titleBarStyle: 'hidden', trafficLightPosition: MAC_TRAFFIC_LIGHTS };
  if (platform === 'win32')
    return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(dark ? 'dark' : 'light') };
  return {};
}

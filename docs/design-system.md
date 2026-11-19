# Levuvo design system

The shared foundation for every screen. New UI (assistant, spaces, tasks, …) uses **only** these
tokens and components. `npm test` fails when a stylesheet uses raw font sizes, font weights,
z-index numbers, radii, spacing or colours (`scripts/check-design-tokens.mjs`, also
`npm run check:tokens`).

## Tokens (`apps/web/src/styles/tokens.css`)

| Group | Tokens | Notes |
| --- | --- | --- |
| Colour | `--bg --surface --surface-2 --surface-3 --surface-hover --sidebar --border --border-strong --text --text-2 --muted --faint --accent --accent-text --selected --live --warn(-bg/-text) --danger(-bg/-text) --ok(-bg/-text) --info-bg --star --scrim` | Dark and light theme. Text colours meet WCAG AA (≥ 4.5:1) on their surfaces. Fixed: `--paper --on-danger --on-warn --event-default`. |
| Spacing | `--space-0-5` 2px · `-1` 4 · `-1-5` 6 · `-2` 8 · `-2-5` 10 · `-3` 12 · `-3-5` 14 · `-4` 16 · `-5` 20 · `-6` 24 · `-7` 28 · `-8` 32 · `-10` 40 · `-12` 48 · `-16` 64 | 4px grid with 2px half steps below 16px. `1px` hairlines are allowed. |
| Type | `--text-2xs` 10 · `xs` 11 · `sm` 12 · `md` 13 · `base` 14 · `lg` 16 · `xl` 18 · `2xl` 20 · `3xl` 24 · `4xl` 28 · `display` 40 | In `rem`, so the system font size is respected. `--leading-tight/snug/normal/relaxed`, `--weight-regular/medium/semibold/bold/heavy`. |
| Radius | `--radius-sm` 4 · `--radius-md` 6 · `--radius-lg` 10 · `--radius-full` | `50%` for circles. |
| Layers | `--z-base` < `raised` < `sticky` < `dropdown` < `drawer-scrim` < `drawer` < `overlay` < `popover-dismiss` < `popover` < `composer` < `modal` < `preview` < `dialog` < `toast` | Never use raw numbers. |
| Elevation | `--elevation-1/2/3` | |
| Controls | `--control-h-sm/--control-h/--control-h-lg`, `--touch-target`, `--field-w` | Touch target is 24px (WCAG 2.2 AA) and grows to 44px on touch screens (`pointer: coarse`). |
| Motion | `--duration-fast`, `--duration`, `--ease` | Animations are switched off under `prefers-reduced-motion`. |
| Layout | `--rail-w`, `--sidebar-w`, `--content-max` | |

Breakpoints: **640px** (phone), **960px** (tablet, one content column), **1180px** (narrow desktop).

## Stylesheets (`apps/web/src/styles/`)

`index.css` imports one file per area in cascade order: `tokens`, `base`, `shell`, `mail`, `menus`,
`reader`, `composer`, `dialogs`, `settings`, `calendar`, `contacts`, `onboarding`, `responsive`,
`features-2-1`, `ui-primitives`, `mobile`, `contrast`. A new feature (assistant, spaces, tasks …)
adds **its own file** (e.g. `styles/assistant.css`) and one `@import` line before `mobile.css`,
so parallel work does not collide in a shared file. Phone rules for a feature go into a
`@media (max-width: 640px)` block in the feature's own file.

## Components (`apps/web/src/ui`)

```tsx
import { Button, IconButton, Field, Segmented, Dialog, Toolbar, useFocusTrap } from './ui';
```

| Component | Use for | Accessibility built in |
| --- | --- | --- |
| `Button` (`variant` default/primary/danger/primary-danger/ghost, `size`, `icon`, `busy`) | Every text button | Native `<button type="button">`, `aria-busy`, decorative icon hidden |
| `IconButton` (`label`, `icon`, `pressed`) | Icon-only actions | Accessible name required (also tooltip), `aria-pressed` for toggles, min. touch target |
| `Field` (`label`, `hint`, `error`, `required`) wrapping one control | Every form input | `<label for>`, `aria-describedby` for hint and error, `aria-invalid`, error announced |
| `Segmented` (`label`, `value`, `options`, `onChange`) | 2–5 exclusive options | `radiogroup`, one tab stop, arrow keys / Home / End |
| `Dialog` (`title`, `onClose`, `description`, `footer`, `size`, `role`, `dismissible`, `onSubmit`) | Every modal | Focus trap and focus return, Escape, labelled + described, portal; bottom sheet on phones |
| `Toolbar` (`label`, `items`, `end`) | Action rows (reader, lists, editors) | `role="toolbar"` with one tab stop and arrow keys; items that don't fit move into a "More actions" menu (`menu` with arrow keys, Escape) instead of wrapping |
| `useFocusTrap()` | Custom modal surfaces that can't use `Dialog` | Same trap as `Dialog` |

## Rules for new screens

1. Colours, spacing, sizes, radii and layers only via tokens.
2. Interactive elements only via the components above (or native elements with the same guarantees).
3. Every icon-only control has a label; every input has a visible label (or `Field hideLabel` with a reason).
4. Focus must stay visible (`:focus-visible` ring) and follow a logical order; modals trap focus.
5. Check each screen at 390px, 900px and 1440px width, in dark and light mode, and at 200 % zoom;
   nothing may scroll horizontally at 320px.
6. Phones (≤ 640px): bottom navigation (`--bottom-nav-h`) and safe areas (`env(safe-area-inset-*)`)
   are reserved; fixed elements sit above them. Use `dvh`, never `vh`.
7. `npm run test:a11y` (axe-core in Chromium, part of CI) must stay free of violations; add new
   screens to `test/a11y/a11y.test.mjs`.
8. In settings, free-text fields use `<Row wide>`: the field sits below the label at full width.
9. User-visible texts go through `t('…')` with an English entry in `i18n-en.ts`.
10. Desktop window frame (`styles/window-frame.css`): the desktop app has no system title bar. The
    top `--titlebar-h` strip moves the window; controls in it are no-drag automatically. On Windows
    the top right `--window-controls-w` belongs to the window buttons: a header that reaches the
    right edge at the top of a view must keep that width free (see the existing rules there).

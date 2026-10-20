/**
 * Every host DOM landmark this plugin depends on, in one place.
 *
 * The DSH browser client guarantees no CSS class names, so the plugin targets
 * documented behavioural markers instead: slot anchors (`data-slot`), the
 * frame's own state attributes, and component markers such as
 * `data-composer-card`. Hashed CSS-module classes (`wSkVaW_*`, `uV2eYG_*`) are
 * deliberately NOT used — they change with every build.
 *
 * `scripts/verify-bundle.mjs` and `.agents/skills/dsh-compat-check` assert that
 * each selector still appears in the built bundle, so a host upgrade that moves
 * a landmark fails a mechanical check instead of silently doing nothing.
 */

/** The web shell's single root slot; its only element child is the AppFrame. */
export const ROOT_SLOT = '[data-slot="root"]';

/** The three-column AppFrame (`grid-template-columns` lives in its inline style). */
export const FRAME = '[data-slot="root"] > div';

/** Sidebar column. The slot anchor is `display:contents`, so the column is its parent. */
export const SIDEBAR_COLUMN = '[data-slot="root"] > div > div:has(> [data-slot="sidebar"])';

/**
 * Centre column (sidebar | centre | rightbar grid order).
 *
 * Needed because the drawer takes the sidebar out of grid flow; without an
 * explicit `grid-column` the centre is auto-placed into the first track.
 * The rightbar gets the same treatment for symmetry.
 */
export const CENTER_COLUMN = '[data-slot="root"] > div > div:has(> [data-slot="main"])';
export const RIGHTBAR_COLUMN = '[data-slot="root"] > div > div:has(> [data-slot="rightbar"])';

/**
 * The same columns expressed *relative to the frame*, for rules that hang off a
 * frame state such as `:not([data-sidebar-collapsed])`.
 *
 * Composing the absolute selectors above would nest a second
 * `[data-slot="root"]` inside the frame — a combinator that never matches.
 */
export const SIDEBAR_COLUMN_OF_FRAME = '> div:has(> [data-slot="sidebar"])';

/** Column-resize handles; unusable on touch and unnecessary once the rail is a drawer. */
export const COLUMN_HANDLES = '[data-slot="root"] > div > [data-side]';

/** Conversation header (`<header>`) inside its root-scoped slot. */
export const CONVERSATION_HEADER = '[data-slot="conversation.header"] > header';

/** The composer card and the two button groups raised to a touch target. */
export const COMPOSER_CARD = '[data-composer-card]';
export const COMPOSER_BUTTONS = '[data-composer-card] button';
export const MESSAGE_ACTIONS = '[data-actions-reveal] button';

/**
 * View tabs, recorded but deliberately NOT resized.
 *
 * Measured on the live page at 390x844: raising these to 44px grows their row
 * from 35px to 54px and the header from 76px to 95px — a permanent 19px of
 * transcript traded for tabs the user taps rarely. Kept here because the probe
 * reports their size, and a host rename should still be visible.
 */
export const VIEW_TABS = '[data-conversation-tabs] button';

/** Transcript scrollport; also the anchor for overscroll containment. */
export const CONVERSATION_SCROLL = '[data-conversation-scroll]';

/** Markdown table wrappers: a stable semantic class plus the structural parent of `<table>`. */
export const WIDE_TABLE = '.md-table-wide';
export const TABLE_WRAPPER = 'div:has(> table)';

/**
 * Frame attribute the host sets while the sidebar is collapsed.
 * Absent means open, so the drawer slides in when the attribute disappears.
 */
export const COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed';

/**
 * Every landmark the stylesheet must actually use, for the mechanical checks.
 * `VIEW_TABS` and `COLLAPSED_ATTRIBUTE` are excluded on purpose: the former is
 * measured but never styled, the latter is read by the activation source rather
 * than written into a selector.
 */
export const HOST_LANDMARKS: readonly { readonly name: string; readonly selector: string }[] = Object.freeze([
  { name: 'root slot', selector: ROOT_SLOT },
  { name: 'frame', selector: FRAME },
  { name: 'sidebar column', selector: SIDEBAR_COLUMN },
  { name: 'centre column', selector: CENTER_COLUMN },
  { name: 'column handles', selector: COLUMN_HANDLES },
  { name: 'conversation header', selector: CONVERSATION_HEADER },
  { name: 'composer card', selector: COMPOSER_CARD },
  { name: 'message actions', selector: MESSAGE_ACTIONS },
  { name: 'conversation scrollport', selector: CONVERSATION_SCROLL },
  { name: 'wide markdown table', selector: WIDE_TABLE },
]);

/**
 * Conversation header's leading seat (`grid-area:1/1`), where the drawer toggle
 * belongs.
 *
 * The header is a two-column grid — `auto minmax(0,1fr)` — whose first column is
 * exactly a navigation control's width, and the host ships that slot EMPTY in the
 * web composition (verified: the only occupant is the `display:contents` anchor).
 * Putting the toggle here makes the title start after it, which is the whole
 * point: a `position:fixed` button floated over the header covered the first
 * characters of the session title on a real phone.
 *
 * A *single* slot is only a contention risk if someone else wants it; nothing in
 * this composition does, and losing the seat degrades to "no drawer toggle"
 * rather than to corrupt layout.
 */
export const HEADER_LEADING_SLOT = 'conversation.header.leading';

/**
 * Frame-wide floating layer (`shell.overlay`), used for the drawer scrim only.
 *
 * Kept for the scrim because a scrim genuinely must float over the whole frame
 * (including the header) rather than participate in the header's grid.
 */
export const OVERLAY_SLOT = 'shell.overlay';

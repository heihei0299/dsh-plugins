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

/**
 * Subagent and background-task badges, rendered by their own plugins into this
 * documented slot, which sits beside the session title in the header.
 */
export const HEADER_ACTIONS = '[data-slot="conversation.session.header.actions"]';

/**
 * Attribute the badge component writes on HEADER_ACTIONS: the categories it is
 * currently replacing (`subagents`, `jobs`). The sheet retires a host badge only
 * for a category that is actually present here, so an unreadable projection
 * falls back to the host's own control.
 */
export const BADGES_ATTRIBUTE = 'data-dsh-mobile-badges';

/** The composer card and the two button groups raised to a touch target. */
export const COMPOSER_CARD = '[data-composer-card]';
/** Resident Lexical editing surface, not a textarea. */
export const COMPOSER_INPUT = '[data-composer-input][contenteditable="true"]';
export const COMPOSER_BUTTONS = '[data-composer-card] button';
/** Footer readings sit outside the card; keep their host-owned dialog controls tappable. */
export const COMPOSER_DOCK = '[data-composer-dock]';
export const COMPOSER_DOCK_BUTTONS = '[data-composer-dock] button[aria-haspopup="dialog"]';
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
 * Settings dialog root.
 *
 * The host marks the panel with `data-shortcut-modal="settings"` — the same
 * marker its own shortcut layer uses — and portals it to <body>; the root
 * attribute still reaches it. On a phone the host's 188px section rail leaves
 * the Models page too little width, so this is the element the narrow-screen
 * sheet reflows.
 */
export const SETTINGS_PANEL = '[data-shortcut-modal="settings"]';

/** Section rail: the title row and the section list (a horizontal strip on mobile). */
export const SETTINGS_NAV = `${SETTINGS_PANEL} > nav`;
export const SETTINGS_NAV_TITLE = `${SETTINGS_NAV} > div:first-child`;
export const SETTINGS_NAV_LIST = `${SETTINGS_NAV} > div:last-child`;
export const SETTINGS_NAV_TAB = `${SETTINGS_NAV_LIST} > button`;

/** Content column, and its two children: the close/action header and the scrolling body. */
export const SETTINGS_CONTENT = `${SETTINGS_PANEL} > div`;
export const SETTINGS_HEADER = `${SETTINGS_CONTENT} > div:first-child`;
export const SETTINGS_OPTIONS = `${SETTINGS_CONTENT} > div:last-child`;

/**
 * First row of a settings list card.
 *
 * The Models page renders one `<li>` per provider with its name and the
 * edit/remove buttons in this row. The host leaves that row `nowrap`, so on a
 * narrow panel the name shrinks to zero and paints under the buttons. Wrapping
 * this row is the structural fix; it does not depend on button copy or hashed
 * class names.
 */
export const SETTINGS_LIST_HEAD = `${SETTINGS_PANEL} [data-slot="settings.section"] li > div:first-child`;

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
  { name: 'settings panel', selector: SETTINGS_PANEL },
  { name: 'settings navigation', selector: SETTINGS_NAV },
  { name: 'settings navigation title', selector: SETTINGS_NAV_TITLE },
  { name: 'settings navigation list', selector: SETTINGS_NAV_LIST },
  { name: 'settings navigation tab', selector: SETTINGS_NAV_TAB },
  { name: 'settings content', selector: SETTINGS_CONTENT },
  { name: 'settings header', selector: SETTINGS_HEADER },
  { name: 'settings options', selector: SETTINGS_OPTIONS },
  { name: 'settings list head', selector: SETTINGS_LIST_HEAD },
  { name: 'conversation header', selector: CONVERSATION_HEADER },
  { name: 'header status badges', selector: HEADER_ACTIONS },
  { name: 'composer card', selector: COMPOSER_CARD },
  { name: 'composer statistics dock', selector: COMPOSER_DOCK },
  { name: 'composer editing surface', selector: COMPOSER_INPUT },
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

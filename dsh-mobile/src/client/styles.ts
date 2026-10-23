import {
  CENTER_COLUMN, COLUMN_HANDLES, COMPOSER_BUTTONS, COMPOSER_DOCK, COMPOSER_DOCK_BUTTONS, COMPOSER_INPUT, CONVERSATION_HEADER, CONVERSATION_SCROLL,
  FRAME, HEADER_ACTIONS, MESSAGE_ACTIONS, RIGHTBAR_COLUMN, SIDEBAR_COLUMN, SIDEBAR_COLUMN_OF_FRAME,
  SETTINGS_CONTENT, SETTINGS_HEADER, SETTINGS_LIST_HEAD, SETTINGS_NAV, SETTINGS_NAV_LIST, SETTINGS_NAV_TAB,
  SETTINGS_NAV_TITLE, SETTINGS_OPTIONS, SETTINGS_PANEL, TABLE_WRAPPER, WIDE_TABLE, BADGES_ATTRIBUTE,
} from './landmarks.js';
import { NARROW_BREAKPOINT, ROOT_ATTRIBUTE } from '../shared/types.js';

/** Recommended minimum touch target, in px. */
export const TAP_TARGET = 44;
/** Vertical space reserved under the transcript for the on-screen keyboard. */
export const KEYBOARD_INSET_VAR = '--dsh-mobile-kb-inset';
/** Drawer width cap: never wider than this fraction of the viewport. */
export const DRAWER_MAX_RATIO = 0.86;
export const DRAWER_MAX_PX = 320;
/** Style-tag identity for the module loader's ownership bookkeeping. */
export const STYLE_TAG_ID = '@local/dsh-mobile/mobile.css';

/**
 * The host's own motion vocabulary, read from `--ds-*` tokens in ui-theme.
 *
 * `sidebar-right` — the shipped right panel — is the reference implementation
 * for an edge panel sliding in, and this stylesheet copies it exactly instead of
 * inventing timings: the same `--ds-transition-duration-slow` (.3s), the same
 * `--ds-ease-in-out` (cubic-bezier(.4,0,.2,1)), and the same delayed-`visibility`
 * trick so the panel stays painted for the whole slide out and only then hides.
 */
export const SLIDE_DURATION = 'var(--ds-transition-duration-slow,.3s)';
export const SLIDE_EASING = 'var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))';
/** Slide + delayed visibility, matching sidebar-right's two-property transition. */
export const SLIDE_TRANSITION = `transform ${SLIDE_DURATION} ${SLIDE_EASING},visibility 0s linear ${SLIDE_DURATION}`;
/** When opening, visibility flips immediately: only the transform animates. */
export const OPEN_TRANSITION = `transform ${SLIDE_DURATION} ${SLIDE_EASING}`;

export interface StyleOptions {
  /** Replace the permanent rail with a drawer opened from a floating button. */
  drawerNavigation: boolean;
  /** Raise small icon controls to TAP_TARGET. */
  comfortableTargets: boolean;
}

/**
 * Build the stylesheet installed while the mobile layout is active.
 *
 * Every rule is scoped under `html[data-dsh-mobile]`, an attribute that exists
 * only while this plugin is active — so removing the attribute is a complete,
 * instant rollback and a desktop document never matches a single rule here.
 * The frame's grid columns are inline styles owned by the host, so overriding
 * them needs `!important`; nothing else in this sheet escalates.
 * @param options - resolved settings for this activation.
 * @returns a complete stylesheet.
 */
export function buildStyles(options: StyleOptions): string {
  const scope = `html[${ROOT_ATTRIBUTE}]`;
  const frame = `${scope} ${FRAME}`;
  const rules: string[] = [];

  rules.push(`${scope}{-webkit-text-size-adjust:100%;text-size-adjust:100%}`);
  // 100% of #root ignores the URL bar on mobile browsers; 100dvh tracks it.
  // border-box keeps the safe-area padding from re-introducing the same overflow.
  rules.push(`${scope},${scope} body,${scope} #root{height:100dvh}`);
  rules.push(`${frame}{height:100dvh;box-sizing:border-box}`);

  if (options.drawerNavigation) {
    // The rail costs 56px of a 390px viewport (17% of the reading width) and its
    // own toggle lives inside the rail, so keeping it is the worst of both worlds.
    rules.push(`${frame}{grid-template-columns:0 minmax(0,1fr) 0!important}`);
    const drawerWidth = `min(${Math.round(DRAWER_MAX_RATIO * 100)}vw,${DRAWER_MAX_PX}px)`;
    // Pinning every column to an explicit track is REQUIRED, not cosmetic: a
    // fixed-position sidebar leaves the grid flow, and without these the centre
    // would be auto-placed into the first (0px) track and vanish.
    rules.push(`${scope} ${CENTER_COLUMN}{grid-column:2}`);
    rules.push(`${scope} ${RIGHTBAR_COLUMN}{grid-column:3}`);
    // Only where the column is painted changes; whether it is open stays the
    // host's own fact, read off the attribute it already sets on the frame.
    //
    // Motion is the host's own, copied from `sidebar-right`:
    //   closed: transform off-screen + visibility hidden, both transitioned,
    //           visibility delayed by the slide duration so the panel stays
    //           painted while it slides out and hides only at the end.
    //   open:   visibility visible immediately, transform back to 0, so ONLY the
    //           transform animates.
    // Plus one difference that is not cosmetic: the open state drops
    // `visibility`'s own delayed transition, exactly as the host does, otherwise
    // the panel would stay invisible for .3s before appearing.
    //
    // The drawer paints its OWN opaque background. The host unmounts the panel
    // content while collapsed and rebuilds it on open, so without this the user
    // sees an empty sliding pane that fills in a quarter of a second later.
    rules.push(`${scope} ${SIDEBAR_COLUMN}{position:fixed;inset-block:0;inset-inline-start:0;width:${drawerWidth}!important;max-width:${drawerWidth};z-index:40;height:100dvh;box-sizing:border-box;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));box-shadow:0 0 24px rgb(0 0 0 / 32%);transform:translateX(-100%);visibility:hidden;transition:${SLIDE_TRANSITION}}`);
    rules.push(`${scope} ${SIDEBAR_COLUMN} > *{width:100%!important}`);
    rules.push(`${scope} ${FRAME}:not([data-sidebar-collapsed]) ${SIDEBAR_COLUMN_OF_FRAME}{transform:translateX(0)!important;visibility:visible;transition:${OPEN_TRANSITION}}`);
    // Respect the OS preference the same way the host does: drop the motion, keep
    // the state change.
    rules.push(`@media (prefers-reduced-motion:reduce){${scope} ${SIDEBAR_COLUMN},${scope} ${FRAME}:not([data-sidebar-collapsed]) ${SIDEBAR_COLUMN_OF_FRAME}{transition:none}}`);
  }

  // Column-resize handles are pointer-only; on touch they only swallow taps.
  rules.push(`${scope} ${COLUMN_HANDLES}{display:none}`);

  // Horizontal padding only: the host's 20px/28px gutters cost ~48px of a 390px
  // header. Vertical metrics stay the host's, because overriding min-height made
  // the two-row header TALLER (76px -> 80px) rather than shorter.
  // 6px under the tabs keeps the view row off the divider without growing the
  // header: the 32px toggle leaves enough slack inside the host's 76px.
  rules.push(`${scope} ${CONVERSATION_HEADER}{padding-inline:12px;padding-bottom:6px}`);
  // overscroll containment keeps a downward pull inside the transcript instead
  // of navigating/refreshing away a streaming answer.
  // The keyboard inset is padding on the scrollport: verified on the live page
  // that padding here lifts the sticky composer (card bottom 814px -> 514px for
  // a 300px inset), because the composer is sticky INSIDE this scrollport.
  rules.push(`${scope} ${CONVERSATION_SCROLL}{overscroll-behavior-y:contain;padding-bottom:calc(env(safe-area-inset-bottom) + var(${KEYBOARD_INSET_VAR},0px))}`);

  // Touch devices have no hover, so the host's hover-to-scroll table widening
  // never triggers: a 4+ column table stays clipped with no way to reach it.
  rules.push(`${scope} ${WIDE_TABLE},${scope} ${TABLE_WRAPPER}{overflow-x:auto!important;overscroll-behavior-x:contain;touch-action:pan-x pan-y pinch-zoom;padding-bottom:0!important}`);

  // Retire a host badge only while its compact replacement is rendered. The
  // component publishes which categories it covers on the slot anchor, so an
  // unreadable projection falls back to the host control instead of nothing.
  rules.push(`${scope} ${HEADER_ACTIONS}[${BADGES_ATTRIBUTE}~="subagents"] > *:not(.dsh-mobile-badge-group):is([aria-label*="子智能体"],[aria-label*="subagent" i],:has([aria-label*="子智能体"]),:has([aria-label*="subagent" i])){display:none}`);
  rules.push(`${scope} ${HEADER_ACTIONS}[${BADGES_ATTRIBUTE}~="jobs"] > *:not(.dsh-mobile-badge-group):is([aria-label*="后台任务"],[aria-label*="job" i],:has([aria-label*="后台任务"]),:has([aria-label*="job" i])){display:none}`);

  rules.push(`${scope} :is(button,[role="button"],summary,a[href]){touch-action:manipulation}`);
  // The dock is outside data-composer-card, so the card's larger targets never
  // reached these 20–22px-high controls. Reserve the safe area on the sticky
  // footer itself: padding on the surrounding scrollport alone can scroll away.
  rules.push(`${scope} ${COMPOSER_DOCK}{padding-bottom:env(safe-area-inset-bottom)}`);

  if (options.comfortableTargets) {
    const target = `${TAP_TARGET}px`;
    // Composer card/dock controls and message actions. The View tabs are deliberately
    // excluded: raising them to 44px grows their row from 35px to 54px and takes
    // the header from 76px to 95px on a 390px screen — a permanent 19px loss of
    // transcript against ~4 tap targets that sit in a row the user taps rarely.
    rules.push(`${scope} ${COMPOSER_BUTTONS},${scope} ${COMPOSER_DOCK_BUTTONS},${scope} ${MESSAGE_ACTIONS}{min-width:${target};min-height:${target}}`);
  }

  // Include the resident contenteditable composer, not just native form fields.
  // Preserve browser zoom; avoiding focus zoom must not disable pinch zoom.
  rules.push(`@media (pointer:coarse){${scope} :is(input,textarea,select,${COMPOSER_INPUT}){font-size:16px!important}}`);

  // Settings dialog, reported on the Models page: the host's fixed 188px section
  // rail leaves a 390px viewport ~154px of content, and the provider row head is
  // `nowrap`, so the name shrinks to zero and paints under "edit / remove".
  // Below the same breakpoint that decides the mobile layout, turn the panel into
  // a full-screen sheet: the rail becomes a scrollable section strip, the close
  // header floats in the title row, and list rows may wrap. The media query is
  // deliberate — a wide touch device keeps the host's centred 800px dialog, where
  // the rail already has room. No host class names are involved.
  const settingsSheet = [
    `${SETTINGS_PANEL}{width:100%;max-width:100%;height:100dvh;max-height:100dvh;border-radius:0;flex-direction:column}`,
    `${SETTINGS_NAV}{width:100%;flex:none;flex-direction:column;gap:0;padding:calc(env(safe-area-inset-top) + 8px) 12px 0;box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l2,#e5e7eb)}`,
    `${SETTINGS_NAV_TITLE}{display:flex;align-items:center;min-height:32px;padding:0 96px 0 4px;margin-bottom:6px;box-sizing:border-box}`,
    `${SETTINGS_NAV_LIST}{width:100%;box-sizing:border-box;flex-direction:row;gap:4px;padding:4px 4px 8px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch}`,
    `${SETTINGS_NAV_LIST}::-webkit-scrollbar{display:none}`,
    `${SETTINGS_NAV_TAB}{flex:none;height:40px;padding:0 12px;border-radius:999px;white-space:nowrap}`,
    `${SETTINGS_CONTENT}{flex:1;min-height:0;min-width:0}`,
    // The document action and the close button belong in the title row; taking
    // the header out of flow keeps them there without moving any DOM.
    `${SETTINGS_HEADER}{position:absolute;top:calc(env(safe-area-inset-top) + 10px);inset-inline-end:8px;z-index:2;height:auto;min-height:28px;max-width:calc(100% - 24px);padding:0;align-items:center;flex-wrap:wrap;justify-content:flex-end}`,
    `${SETTINGS_OPTIONS}{padding:0 16px calc(env(safe-area-inset-bottom) + 16px);overscroll-behavior:contain;-webkit-overflow-scrolling:touch}`,
    // The host row head has no wrap. Wrapping moves the actions to a second line
    // when the name needs the width, instead of squeezing the name to zero.
    `${SETTINGS_LIST_HEAD}{flex-wrap:wrap;row-gap:6px}`,
    `${SETTINGS_LIST_HEAD} > span:first-child{min-width:0;overflow-wrap:anywhere}`,
  ];
  rules.push(`@media (max-width:${NARROW_BREAKPOINT}px){${settingsSheet.join('')}}`);

  // The toggle sits in the conversation header's own leading seat, so it takes
  // real layout space and the session title starts after it. A floating button
  // here covered the first characters of the title on a real phone.
  // 32px visually, 44px hit area: a 44px box forced the title row to 44px and
  // the header to 90px on a 390px phone, for no extra reach.
  // Marked `data-window-drag`-exempt by the host's no-drag rule for header
  // controls; sizes use the host's fast tier for press feedback.
  rules.push(`.dsh-mobile-toggle{position:relative;display:grid;place-items:center;width:32px;height:32px;flex:none;border:0;border-radius:999px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-overlay,#fff));box-shadow:0 1px 6px rgb(0 0 0 / 14%);touch-action:manipulation;-webkit-app-region:no-drag;transform:scale(1);transition:transform var(--ds-transition-duration-fast,.1s) var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}`);
  // Invisible 44px tap surface that costs no layout space.
  rules.push(`.dsh-mobile-toggle::after{content:"";position:absolute;inset:-6px;border-radius:999px}`);
  rules.push(`.dsh-mobile-toggle:active{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-2,#f3f3f3));transform:scale(.92)}`);
  // Global panels replace the conversation header. Keep their navigation entry
  // in a safe-area-aware bottom corner instead of covering a panel's title.
  rules.push(`.dsh-mobile-toggle-fallback{position:fixed;inset-inline-start:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:38;pointer-events:auto;width:${TAP_TARGET}px;height:${TAP_TARGET}px}`);
  // Compact status badges: an icon plus a count instead of the host's long
  // localized label, so the session title keeps its width on a 390px header.
  rules.push(`.dsh-mobile-badge-group{position:relative;display:inline-flex;align-items:center;gap:6px;flex:none}`);
  rules.push(`.dsh-mobile-badge{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:2px;height:24px;min-width:30px;padding:0 7px;border:0;border-radius:12px;cursor:pointer;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f2f4f7));color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-primary));font-size:11px;line-height:1;touch-action:manipulation;-webkit-app-region:no-drag;transition:background var(--ds-transition-duration-fast,.1s) var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}`);
  rules.push(`.dsh-mobile-badge svg{width:13px;height:13px;flex:none}`);
  rules.push(`.dsh-mobile-badge-count{font-variant-numeric:tabular-nums}`);
  rules.push(`.dsh-mobile-badge-dot{position:absolute;top:3px;inset-inline-end:3px;width:5px;height:5px;border-radius:999px;background:var(--dsw-alias-state-business-primary,#2f6bff)}`);
  rules.push(`.dsh-mobile-badge:active{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-1,#e8ebf0))}`);
  // Status popup: a compact card anchored to its icon. It is a native popover,
  // so the browser paints it in the TOP LAYER: the host header's
  // `overflow:hidden` and `container-type:inline-size` cannot clip it, and no
  // ancestor stacking context can offset it. `inset:auto` plus a top/left written
  // by `StatusPanel` keeps it beside the icon — never pinned to the screen bottom
  // and never a full-screen dimming sheet. `display:none` until open keeps the
  // author rule from fighting the UA's closed-popover rule.
  rules.push(`.dsh-mobile-badge-panel{position:fixed;inset:auto;margin:0;box-sizing:border-box;display:none;flex-direction:column;width:min(360px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:0;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:16px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-primary,#17212f);box-shadow:0 12px 32px rgb(0 0 0 / 18%);overflow:hidden}`);
  rules.push(`.dsh-mobile-badge-panel:popover-open{display:flex}`);
  rules.push(`.dsh-mobile-badge-panel-header{display:flex;align-items:center;gap:10px;flex:none;padding:10px 12px 6px}`);
  rules.push(`.dsh-mobile-badge-panel-icon{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f2f4f7));color:var(--dsw-alias-label-secondary,#667085)}`);
  rules.push(`.dsh-mobile-badge-panel-icon svg{width:16px;height:16px}`);
  rules.push(`.dsh-mobile-badge-panel-heading{flex:1;min-width:0}`);
  rules.push(`.dsh-mobile-badge-panel-title{margin:0;font-size:14px;font-weight:600;line-height:20px}`);
  rules.push(`.dsh-mobile-badge-panel-summary{margin:1px 0 0;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:16px}`);
  // 32px visual box, 44px hit area via ::after: a big close button would turn the
  // card back into a panel, a small one would be unhittable on a phone.
  rules.push(`.dsh-mobile-badge-panel-close{position:relative;display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f2f4f7));color:var(--dsw-alias-label-secondary,#667085);cursor:pointer;touch-action:manipulation}`);
  rules.push(`.dsh-mobile-badge-panel-close::after{content:"";position:absolute;inset:-6px;border-radius:999px}`);
  rules.push(`.dsh-mobile-badge-panel-close svg{width:16px;height:16px}`);
  rules.push(`.dsh-mobile-badge-panel-hint{flex:none;margin:0;padding:0 12px 8px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:16px}`);
  rules.push(`.dsh-mobile-badge-panel-list{flex:1 1 auto;min-height:0;margin:0;padding:0 6px 6px;list-style:none;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}`);
  rules.push(`.dsh-mobile-badge-panel-list > li + li{border-top:.5px solid var(--dsw-alias-border-l2,#e5e7eb)}`);
  rules.push(`.dsh-mobile-badge-empty{padding:20px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#667085);font-size:13px}`);
  // The label owns its own line and wraps completely; status and progress each
  // get a line of their own, so a long task name never collides with raw English
  // status text the way it did in the old 240px dropdown.
  rules.push(`.dsh-mobile-badge-row{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;min-height:48px;padding:8px 6px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;text-align:start}`);
  rules.push(`.dsh-mobile-badge-row:is(button){cursor:pointer;touch-action:manipulation}`);
  rules.push(`.dsh-mobile-badge-row:is(button):active,.dsh-mobile-badge-panel-close:active{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f2f4f7))}`);
  rules.push(`.dsh-mobile-badge-row:focus-visible,.dsh-mobile-badge-panel-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2f6bff);outline-offset:-2px}`);
  rules.push(`.dsh-mobile-badge-row-body{display:flex;flex-direction:column;align-items:flex-start;gap:4px;flex:1;min-width:0}`);
  rules.push(`.dsh-mobile-badge-row-label{max-width:100%;font-size:13px;font-weight:500;line-height:19px;white-space:normal;overflow-wrap:anywhere}`);
  rules.push(`.dsh-mobile-badge-row-meta{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);color:var(--dsw-alias-label-secondary,#667085);font-size:11px;line-height:16px}`);
  rules.push(`.dsh-mobile-badge-row-dot{width:6px;height:6px;flex:none;border-radius:999px;background:var(--dsw-alias-label-caption,#98a2b3)}`);
  rules.push(`.dsh-mobile-badge-row-meta[data-tone="live"] .dsh-mobile-badge-row-dot{background:var(--dsw-alias-state-business-primary,#2f6bff)}`);
  rules.push(`.dsh-mobile-badge-row-meta[data-tone="success"] .dsh-mobile-badge-row-dot{background:var(--dsw-static-green-500,#22c55e)}`);
  rules.push(`.dsh-mobile-badge-row-meta[data-tone="error"] .dsh-mobile-badge-row-dot{background:var(--dsw-static-red-500,#ef4444)}`);
  rules.push(`.dsh-mobile-badge-row-detail{max-width:100%;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere}`);
  rules.push(`.dsh-mobile-badge-row-arrow{flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#667085)}`);
  // Keep the scrim in hit-testing throughout the drawer's exit. Delayed
  // visibility hides it only once the shared slide/fade duration has elapsed;
  // an initially closed (hidden) scrim still cannot intercept any input.
  rules.push(`.dsh-mobile-scrim{position:fixed;inset:0;z-index:39;pointer-events:auto;border:0;padding:0;margin:0;background:rgb(0 0 0 / 38%);touch-action:none;cursor:pointer;opacity:0;visibility:hidden;transition:opacity ${SLIDE_DURATION} ${SLIDE_EASING},visibility 0s linear ${SLIDE_DURATION}}`);
  rules.push(`.dsh-mobile-scrim[data-open]{opacity:1;visibility:visible;transition:opacity ${SLIDE_DURATION} ${SLIDE_EASING}}`);
  rules.push(`@media (prefers-reduced-motion:reduce){.dsh-mobile-toggle,.dsh-mobile-scrim,.dsh-mobile-scrim[data-open]{transition:none}}`);

  return `${rules.join('\n')}\n`;
}

/**
 * Styles for the settings row only.
 *
 * Installed for the plugin's whole lifetime rather than per activation: the row
 * is how the user turns the mobile layout on, so it has to be styled while the
 * layout is off. Everything is keyed by this plugin's own class prefix, so no
 * host element can match it.
 */
export const SETTINGS_STYLES = [
  '.dsh-mobile-settings{display:flex;flex-direction:column;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:var(--dsh-content-font-size,14px);line-height:22px;color:var(--dsw-alias-label-primary)}',
  '.dsh-mobile-setting-title{font-weight:600}',
  '.dsh-mobile-caption{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px}',
  '.dsh-mobile-error{margin:2px 0 0;color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px}',
  '.dsh-mobile-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}',
  '.dsh-mobile-setting-row select{min-height:32px;min-width:140px;max-width:60%;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#f9f9f9));color:inherit;font:inherit;padding:0 8px}',
  '.dsh-mobile-setting-row select:disabled{opacity:.55}',
  '@media (pointer:coarse){.dsh-mobile-setting-row select{min-height:44px;font-size:16px}}',
].join('\n');

import {
  CENTER_COLUMN, COLUMN_HANDLES, COMPOSER_BUTTONS, CONVERSATION_HEADER, CONVERSATION_SCROLL,
  FRAME, MESSAGE_ACTIONS, RIGHTBAR_COLUMN, SIDEBAR_COLUMN, SIDEBAR_COLUMN_OF_FRAME,
  TABLE_WRAPPER, WIDE_TABLE,
} from './landmarks.js';
import { ROOT_ATTRIBUTE } from '../shared/types.js';

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
  rules.push(`${scope} ${CONVERSATION_HEADER}{padding-inline:12px}`);
  // overscroll containment keeps a downward pull inside the transcript instead
  // of navigating/refreshing away a streaming answer.
  // The keyboard inset is padding on the scrollport: verified on the live page
  // that padding here lifts the sticky composer (card bottom 814px -> 514px for
  // a 300px inset), because the composer is sticky INSIDE this scrollport.
  rules.push(`${scope} ${CONVERSATION_SCROLL}{overscroll-behavior-y:contain;padding-bottom:calc(env(safe-area-inset-bottom) + var(${KEYBOARD_INSET_VAR},0px))}`);

  // Touch devices have no hover, so the host's hover-to-scroll table widening
  // never triggers: a 4+ column table stays clipped with no way to reach it.
  rules.push(`${scope} ${WIDE_TABLE},${scope} ${TABLE_WRAPPER}{overflow-x:auto!important;overscroll-behavior-x:contain;touch-action:pan-x pan-y;padding-bottom:0!important}`);

  rules.push(`${scope} :is(button,[role="button"],summary,a[href]){touch-action:manipulation}`);

  if (options.comfortableTargets) {
    const target = `${TAP_TARGET}px`;
    // Composer controls and message actions only. The View tabs are deliberately
    // excluded: raising them to 44px grows their row from 35px to 54px and takes
    // the header from 76px to 95px on a 390px screen — a permanent 19px loss of
    // transcript against ~4 tap targets that sit in a row the user taps rarely.
    rules.push(`${scope} ${COMPOSER_BUTTONS},${scope} ${MESSAGE_ACTIONS}{min-width:${target};min-height:${target}}`);
  }

  // iOS zooms the viewport when a focused field is under 16px; the host's own
  // inputs are 13.33px, and only the coarse-pointer case is affected.
  rules.push(`@media (pointer:coarse){${scope} :is(input,textarea,select){font-size:16px!important}}`);

  // The toggle sits in the conversation header's own leading seat, so it takes
  // real layout space and the session title starts after it. A floating button
  // here covered the first characters of the title on a real phone.
  // Marked `data-window-drag`-exempt by the host's no-drag rule for header
  // controls; sizes use the host's fast tier for press feedback.
  rules.push(`.dsh-mobile-toggle{display:grid;place-items:center;width:${TAP_TARGET}px;height:${TAP_TARGET}px;flex:none;border:0;border-radius:999px;cursor:pointer;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-overlay,#fff));box-shadow:0 2px 10px rgb(0 0 0 / 18%);touch-action:manipulation;-webkit-app-region:no-drag;transform:scale(1);transition:transform var(--ds-transition-duration-fast,.1s) var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}`);
  rules.push(`.dsh-mobile-toggle:active{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-2,#f3f3f3));transform:scale(.92)}`);
  // The scrim stays mounted and floats over the whole frame — it is the one
  // element that genuinely must cover the header too. It mirrors sidebar's `.15s`
  // opacity fade and delayed visibility, so it clears as the drawer slides out.
  rules.push(`.dsh-mobile-scrim{position:fixed;inset:0;z-index:39;pointer-events:none;border:0;padding:0;margin:0;background:rgb(0 0 0 / 38%);touch-action:none;cursor:pointer;opacity:0;visibility:hidden;transition:opacity .15s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1)),visibility 0s linear .15s}`);
  rules.push(`.dsh-mobile-scrim[data-open]{pointer-events:auto;opacity:1;visibility:visible;transition:opacity .15s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))}`);
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

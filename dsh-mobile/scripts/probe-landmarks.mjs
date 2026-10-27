/**
 * Key host landmarks for the live probe, plus the pure acceptance verdict.
 *
 * This is deliberately plain ESM: `scripts/browser-probe.mjs` runs under bare
 * node in an environment where installing the project is not required, so it
 * cannot import the TypeScript landmarks module. The selectors are duplicated
 * and `tests/landmark-contract.test.ts` keeps every shared name byte-identical
 * to `src/client/landmarks.ts`.
 *
 * The probe is a LIVE host check. `scripts/verify-bundle.ts` only proves the
 * built artifact still uses the plugin's own landmark selectors; it can never
 * observe a host upgrade, because the artifact contains no host markup.
 *
 * Page-state awareness: the root outlet, the AppFrame and its three column
 * anchors are unconditional and always required, so renaming one cannot switch
 * a whole group of checks off. A conversation, an open settings dialog, view
 * tabs and wide tables are conditional: their landmarks are required only when
 * the page shows the anchor that makes them applicable, and `--expect <anchor>`
 * turns a missing conditional anchor into an explicit failure. Landmarks marked
 * `null` are reported but never required (drag handles only exist on wide
 * pointer layouts, `.md-table-wide` only exists for wide Markdown tables).
 */

/**
 * The AppFrame's column anchors are unconditional: the host renders all three
 * column wrappers (and their slot anchors) on every page, so their absence means
 * a host rename, not a different page state. A page state that only exists
 * sometimes (conversation, settings, tabs, tables) stays conditional and must be
 * declared with `--expect <anchors key>` when it is the acceptance target;
 * otherwise its absence is read as "this page is not in that state".
 */
const SIDEBAR_ANCHOR = '[data-slot="sidebar"]';
const MAIN_ANCHOR = '[data-slot="main"]';
const RIGHTBAR_ANCHOR = '[data-slot="rightbar"]';

/** Stable selector for a host anchor that decides whether a group is applicable. */
export const PROBE_ANCHORS = Object.freeze({
  sidebar: SIDEBAR_ANCHOR,
  main: MAIN_ANCHOR,
  rightbar: RIGHTBAR_ANCHOR,
  conversation: '[data-slot="conversation.session.header"]',
  composer: '[data-composer-card]',
  messageActions: '[data-actions-reveal]',
  tabs: '[data-conversation-tabs]',
  table: 'table',
  settings: '[data-shortcut-modal="settings"]',
  settingsList: '[data-shortcut-modal="settings"] [data-slot="settings.section"] li',
});

/**
 * Landmarks measured in the page.
 *
 * `when` is `'always'`, a {@link PROBE_ANCHORS} key, or `null` (report only).
 * Names shared with `HOST_LANDMARKS` must keep exactly the same selector.
 */
export const PROBE_LANDMARKS = Object.freeze([
  // Shell: every DSH page renders the root outlet and the AppFrame.
  { key: 'root-slot', name: 'root slot', selector: '[data-slot="root"]', when: 'always' },
  { key: 'frame', name: 'frame', selector: '[data-slot="root"] > div', when: 'always' },
  // The AppFrame always renders these three anchors; requiring them turns an
  // anchor rename into a failure instead of silently switching a whole group
  // off. Columns hang off the anchors and are what the drawer / grid target.
  { key: 'sidebar-anchor', name: 'sidebar anchor', selector: SIDEBAR_ANCHOR, when: 'always' },
  { key: 'main-anchor', name: 'main anchor', selector: MAIN_ANCHOR, when: 'always' },
  { key: 'rightbar-anchor', name: 'rightbar anchor', selector: RIGHTBAR_ANCHOR, when: 'always' },
  { key: 'sidebar-column', name: 'sidebar column', selector: '[data-slot="root"] > div > div:has(> [data-slot="sidebar"])', when: 'sidebar' },
  { key: 'center-column', name: 'centre column', selector: '[data-slot="root"] > div > div:has(> [data-slot="main"])', when: 'main' },
  { key: 'rightbar-column', name: 'rightbar column', selector: '[data-slot="root"] > div > div:has(> [data-slot="rightbar"])', when: 'rightbar' },
  // Handles are pointer-only and legitimately absent on a phone.
  { key: 'column-handles', name: 'column handles', selector: '[data-slot="root"] > div > [data-side]', when: null },

  // The settings dialog only exists while it is open, so its whole subtree is
  // optional; the Models list row is additionally gated by its own <li>.
  { key: 'settings-panel', name: 'settings panel', selector: '[data-shortcut-modal="settings"]', when: null },
  { key: 'settings-nav', name: 'settings navigation', selector: '[data-shortcut-modal="settings"] > nav', when: 'settings' },
  { key: 'settings-nav-title', name: 'settings navigation title', selector: '[data-shortcut-modal="settings"] > nav > div:first-child', when: 'settings' },
  { key: 'settings-nav-list', name: 'settings navigation list', selector: '[data-shortcut-modal="settings"] > nav > div:last-child', when: 'settings' },
  { key: 'settings-nav-tab', name: 'settings navigation tab', selector: '[data-shortcut-modal="settings"] > nav > div:last-child > button', when: 'settings' },
  { key: 'settings-content', name: 'settings content', selector: '[data-shortcut-modal="settings"] > div', when: 'settings' },
  { key: 'settings-header', name: 'settings header', selector: '[data-shortcut-modal="settings"] > div > div:first-child', when: 'settings' },
  { key: 'settings-options', name: 'settings options', selector: '[data-shortcut-modal="settings"] > div > div:last-child', when: 'settings' },
  { key: 'settings-list-head', name: 'settings list head', selector: '[data-shortcut-modal="settings"] [data-slot="settings.section"] li > div:first-child', when: 'settingsList' },

  // Conversation chrome exists once the host renders a session header.
  { key: 'conversation-header', name: 'conversation header', selector: '[data-slot="conversation.header"] > header', when: 'conversation' },
  { key: 'header-actions', name: 'header status badges', selector: '[data-slot="conversation.session.header.actions"]', when: 'conversation' },
  { key: 'conversation-scroll', name: 'conversation scrollport', selector: '[data-conversation-scroll]', when: 'conversation' },
  // The composer can be replaced by a read-only host surface (subagent chat),
  // so the card is required with the conversation but its internals only with
  // the card itself.
  { key: 'composer-card', name: 'composer card', selector: '[data-composer-card]', when: 'conversation' },
  { key: 'composer-input', name: 'composer editing surface', selector: '[data-composer-input][contenteditable="true"]', when: 'composer' },
  { key: 'composer-dock', name: 'composer statistics dock', selector: '[data-composer-dock]', when: 'composer' },
  // Message actions appear per rendered message; the host marker is the gate.
  { key: 'message-actions', name: 'message actions', selector: '[data-actions-reveal] button', when: 'messageActions' },
  // View tabs only render when the host has more than one view.
  { key: 'view-tabs', name: 'view tabs', selector: '[data-conversation-tabs] button', when: 'tabs' },
  // Tables are content-dependent; the wrapper is structural, the wide Markdown
  // class is not present on every table.
  { key: 'table-wrapper', name: 'table wrapper', selector: 'div:has(> table)', when: 'table' },
  { key: 'wide-table', name: 'wide markdown table', selector: '.md-table-wide', when: null },
]);

/** Exit code when the acceptance gate passes. */
export const PROBE_EXIT_PASS = 0;
/** Exit code when the acceptance gate fails (also the probe's runtime failure code). */
export const PROBE_EXIT_FAIL = 1;

/**
 * Evaluate the key-landmark acceptance gate against a probe report.
 *
 * Pure: no browser, no filesystem. The same report the probe prints is the
 * input, so a saved report can be re-evaluated offline.
 *
 * `expect` is the caller's declaration of page state: each name is a
 * {@link PROBE_ANCHORS} key that must be present, so a renamed conditional
 * anchor fails instead of silently skipping its group.
 * @param report - the object `probe()` returns, or arbitrary parsed JSON.
 * @param options - `{ expect: string[] }`.
 * @returns `{ ok, failures }`, where every failure has a stable `code`.
 */
export function probeVerdict(report, options = {}) {
  const expected = Array.isArray(options.expect) ? options.expect : [];
  const failures = [];
  const fail = (code, message) => { failures.push({ code, message }); };
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    fail('no-report', 'The probe produced no report object.');
    return { ok: false, failures };
  }
  if (report.needsTarget === true) {
    fail('no-target', 'No single DSH page matched; open exactly one DSH tab (or pass --target <id>) before the acceptance gate.');
    return { ok: false, failures };
  }
  const page = report.page;
  if (page === null || typeof page !== 'object' || Array.isArray(page)) {
    fail('no-page', 'The probe did not return page measurements.');
    return { ok: false, failures };
  }
  if (typeof page.rootAttribute !== 'string' || page.rootAttribute === '') {
    fail('inactive', 'The mobile layout is not installed on this page (the root attribute is absent).');
  }
  if (!(typeof page.styleTags === 'number' && page.styleTags > 0)) {
    fail('no-stylesheet', 'The plugin stylesheet is not present on this page.');
  }
  if (typeof page.crashes === 'number' && page.crashes > 0) {
    fail('slot-crash', `${page.crashes} slot crash marker(s) found; a host slot or entry failed to render.`);
  }
  const counts = page.landmarks !== null && typeof page.landmarks === 'object' ? page.landmarks : {};
  const anchors = page.anchors !== null && typeof page.anchors === 'object' ? page.anchors : {};
  for (const name of expected) {
    const selector = PROBE_ANCHORS[name];
    if (typeof selector !== 'string') {
      fail(`unknown-expectation:${name}`, `Unknown expected page state "${name}"; expected one of: ${Object.keys(PROBE_ANCHORS).join(', ')}.`);
      continue;
    }
    if (!(typeof anchors[name] === 'number' && anchors[name] > 0)) {
      fail(`expected:${name}`, `Page state "${name}" was expected, but its host anchor (${selector}) is absent.`);
    }
  }
  for (const landmark of PROBE_LANDMARKS) {
    const anchorApplies = landmark.when === 'always'
      || (landmark.when !== null && typeof landmark.when === 'string' && anchors[landmark.when] > 0);
    if (!anchorApplies) continue;
    const count = counts[landmark.key];
    if (count === -1) {
      fail(`invalid:${landmark.key}`, `${landmark.name} (${landmark.selector}) is not a valid selector in this browser.`);
      continue;
    }
    if (typeof count !== 'number' || count < 1) {
      fail(`missing:${landmark.key}`, `${landmark.name} (${landmark.selector}) was not found, but this page state requires it.`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Exit code for a report.
 *
 * Reporting stays non-destructive by default: without `verify`, a report is
 * printed and the process succeeds even when no DSH target was found. The
 * explicit acceptance gate is the only path that turns that into a failure.
 * @param report - the probe report.
 * @param verify - true for acceptance mode.
 * @param expect - declared page states (PROBE_ANCHORS keys).
 * @returns 0 or 1.
 */
export function probeExitCode(report, verify = false, expect = []) {
  if (verify !== true) return PROBE_EXIT_PASS;
  return probeVerdict(report, { expect }).ok ? PROBE_EXIT_PASS : PROBE_EXIT_FAIL;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPEN_TRANSITION, SETTINGS_STYLES, SLIDE_DURATION, SLIDE_EASING, SLIDE_TRANSITION, TAP_TARGET, buildStyles,
} from '../src/client/styles.js';
import { HOST_LANDMARKS } from '../src/client/landmarks.js';

const full = buildStyles({ drawerNavigation: true, comfortableTargets: true });
const plain = buildStyles({ drawerNavigation: false, comfortableTargets: false });

test('every runtime rule is scoped under the root attribute', () => {
  const scoped = full.split('\n').filter(line => line.trim() !== '' && !line.startsWith('@media'));
  const unscoped = scoped.filter(line => !line.startsWith('html[data-dsh-mobile]') && !line.startsWith('.dsh-mobile-'));
  // Only this plugin's own overlay classes may sit outside the root scope; they
  // are rendered by this plugin alone and removed with the stylesheet.
  assert.deepEqual(unscoped, [], `unscoped rules: ${unscoped.join(' | ')}`);
});

test('!important stays confined to the places that provably need it', () => {
  // Each escalation is deliberate and individually justified:
  //   grid-template-columns — the host writes it as an inline style
  //   drawer width / its child width — the host sets pixel widths inline
  //   transform on the open drawer — otherwise ties with the closed rule
  //   overflow-x on tables — the host ships a hover-gated `hidden`
  //   font-size on form fields — iOS zooms a focused field below 16px
  const escalated = full.split('\n').filter(line => line.includes('!important'));
  assert.equal(escalated.length, 6, `unexpected !important count:\n${escalated.join('\n')}`);
  assert.ok(escalated.some(line => line.includes('grid-template-columns')));
  assert.ok(escalated.some(line => line.includes('transform:translateX(0)!important')));
  assert.ok(escalated.some(line => line.includes('overflow-x:auto!important')));
  assert.ok(escalated.some(line => line.includes('font-size:16px!important')));
  assert.ok(escalated.some(line => line.includes('width:min(')));
  assert.ok(escalated.some(line => line.includes('> *{width:100%!important}')));
  // The closed-drawer TRANSFORM must stay unescalated so the open one can win;
  // the same rule legitimately escalates `width` against the host's inline value.
  assert.doesNotMatch(full, /transform:translateX\(-100%\)!important/);
});

test('drawer mode removes the rail, plain mode keeps it', () => {
  assert.match(full, /grid-template-columns:0 minmax\(0,1fr\) 0!important/);
  assert.match(plain, /height:100dvh;box-sizing:border-box/);
  assert.doesNotMatch(plain, /position:fixed;inset-block:0/, 'no drawer positioning when the drawer is off');
  assert.doesNotMatch(full, /grid-template-columns:56px/, 'the rail must not survive drawer mode');
});

test('the drawer follows the host attribute instead of a private state', () => {
  assert.match(full, /translateX\(-100%\)/);
  assert.match(full, /:not\(\[data-sidebar-collapsed\]\) .*translateX\(0\)/);
});

test('the drawer slide copies the host\'s own sidebar-right transition', () => {
  // No hand-rolled timing: this is the exact recipe the shipped right panel uses
  // for an edge pane sliding in — the host's slow tier, its shared easing, and
  // `visibility` delayed by the slide duration so the pane stays painted while it
  // slides out and hides only at the end.
  assert.equal(SLIDE_DURATION, 'var(--ds-transition-duration-slow,.3s)');
  assert.equal(SLIDE_EASING, 'var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1))');
  assert.equal(SLIDE_TRANSITION, `transform ${SLIDE_DURATION} ${SLIDE_EASING},visibility 0s linear ${SLIDE_DURATION}`);
  // Opening must NOT delay visibility, or the panel stays invisible for .3s.
  assert.equal(OPEN_TRANSITION, `transform ${SLIDE_DURATION} ${SLIDE_EASING}`);

  const closedRule = full.split('\n').find(line => line.includes('position:fixed') && line.includes('[data-slot="sidebar"]')) ?? '';
  assert.ok(closedRule.length > 0);
  assert.match(closedRule, /transition:transform var\(--ds-transition-duration-slow/);
  assert.match(closedRule, /visibility:hidden/);
  assert.match(closedRule, /visibility 0s linear var\(--ds-transition-duration-slow/);
  // The drawer paints its own background: the panel body is unmounted while
  // collapsed, so an unbacked pane would slide in empty and then fill in.
  assert.match(closedRule, /background:var\(--dsw-alias-bg-layer-1/);

  const openRule = full.split('\n').find(line => line.includes(':not([data-sidebar-collapsed])') && line.includes('translateX(0)')) ?? '';
  assert.match(openRule, /visibility:visible/);
  assert.doesNotMatch(openRule, /visibility 0s linear/, 'opening must not delay visibility');
});

test('the open drawer rule states its own specificity instead of relying on order', () => {
  // Measured in the browser: the base (closed) rule and an open rule of equal
  // specificity tie, and the tie is resolved by source order — a minifier or a
  // later edit would silently keep the drawer shut. `!important` makes the
  // opened state win regardless of where the rule lands.
  const openRule = full.split('\n').find(line => line.includes(':not([data-sidebar-collapsed])')) ?? '';
  assert.match(openRule, /transform:translateX\(0\)!important/);
  // The two rules must not be identical in specificity by accident.
  const baseRule = full.split('\n').find(line => line.includes('translateX(-100%)')) ?? '';
  assert.doesNotMatch(baseRule, /!important\}?$/, 'the closed state must stay overridable by the open rule');
});

test('wide tables become horizontally scrollable on touch', () => {
  assert.match(full, /\.md-table-wide/);
  assert.match(full, /overflow-x:auto!important/);
  assert.match(full, /touch-action:pan-x pan-y/);
});

test('tap targets rise to the documented minimum, without inflating the header', () => {
  assert.equal(TAP_TARGET, 44);
  assert.match(full, /min-width:44px;min-height:44px/);
  assert.doesNotMatch(plain, /min-width:44px;min-height:44px/);
  // The toggle takes real layout space in the header's leading seat; it must not
  // be position:fixed, which covered the session title on a real phone.
  const toggleRule = full.split('\n').find(line => line.startsWith('.dsh-mobile-toggle{')) ?? '';
  assert.match(toggleRule, /width:44px;height:44px/);
  assert.doesNotMatch(toggleRule, /position:fixed/);
  assert.match(toggleRule, /flex:none/);
  // Measured on the live page: 44px View tabs grow the header from 76px to 95px.
  const targetRule = full.split('\n').find(line => line.includes('min-width:44px;min-height:44px')) ?? '';
  assert.doesNotMatch(targetRule, /data-conversation-tabs/, 'View tabs must stay at the host size');
  assert.match(targetRule, /data-composer-card/);
  assert.match(targetRule, /data-actions-reveal/);
});

test('the header rule touches horizontal padding only', () => {
  const headerRule = full.split('\n').find(line => line.includes('[data-slot="conversation.header"] > header')) ?? '';
  assert.match(headerRule, /padding-inline:12px/);
  assert.doesNotMatch(headerRule, /min-height/, 'overriding the header min-height made it taller, not shorter');
  assert.doesNotMatch(headerRule, /padding:/);
});

test('iOS focus zoom is prevented only where it applies', () => {
  assert.match(full, /@media \(pointer:coarse\)\{html\[data-dsh-mobile\] :is\(input,textarea,select\)\{font-size:16px!important\}\}/);
});

test('safe-area padding is paired with the dynamic viewport height', () => {
  assert.match(full, /100dvh/);
  assert.match(full, /env\(safe-area-inset-bottom\)/);
});

test('every host landmark is actually used by the stylesheet', () => {
  const unused = HOST_LANDMARKS
    .filter(landmark => !landmark.selector.startsWith('data-'))
    // The root slot is only a path prefix of FRAME, so match its suffix.
    .filter(landmark => !full.includes(landmark.selector) && !full.includes(landmark.selector.replace(/^\[data-slot="root"\] > div/, '[data-slot="root"] > div')))
    .map(landmark => landmark.name);
  assert.deepEqual(unused, [], `landmarks declared but unused: ${unused.join(', ')}`);
});

test('the sheet pulls no external resources', () => {
  for (const sheet of [full, plain, SETTINGS_STYLES]) {
    assert.doesNotMatch(sheet, /url\s*\(/i);
    assert.doesNotMatch(sheet, /@import/i);
  }
});

test('settings styles are keyed by this plugin only', () => {
  const selectors = SETTINGS_STYLES.split('}')
    .map(rule => rule.split('{')[0]?.trim() ?? '')
    .filter(selector => selector !== '' && !selector.startsWith('@'))
    .flatMap(selector => selector.split(',').map(part => part.trim()));
  for (const selector of selectors) {
    assert.ok(selector.startsWith('.dsh-mobile-'), `settings selector escapes the plugin prefix: ${selector}`);
  }
});

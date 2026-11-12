/**
 * Declarative dsh-go view for the ADHD switch. The app renders; this module
 * only builds bounded JSON from the controller's data object.
 *
 * The view stays on protocol v1: it uses stack, text, keyValue, callout and
 * actions only, so no component capability negotiation is needed.
 *
 * @module dsh-i-have-adhd/dsh-go/view
 */

import { tr } from './text.js';

const STATS = { $: 'data.stats' };
const NOTICE = { $: 'data.notice' };

/**
 * Build the panel view.
 * @param {{locale?: string}} [caps] - app capabilities; only the locale is used.
 * @returns the v1 view tree.
 */
export function buildView(caps = {}) {
  const locale = caps.locale;
  return {
    v: 1,
    type: 'stack',
    children: [
      { type: 'text', text: tr(locale, 'panel.description') },
      { type: 'keyValue', items: STATS },
      { type: 'divider' },
      { type: 'callout', tone: 'info', text: NOTICE },
      {
        type: 'actions',
        items: [
          { label: tr(locale, 'action.on'), action: { id: 'on' }, style: 'primary' },
          { label: tr(locale, 'action.off'), action: { id: 'off' } },
          { label: tr(locale, 'action.refresh'), action: { id: 'refresh' } }
        ]
      }
    ]
  };
}

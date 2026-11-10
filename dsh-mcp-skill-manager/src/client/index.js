/**
 * Browser half of @local/dsh-mcp-skill-manager.
 *
 * Registers the localized Settings → MCP & Skill section. The container owns
 * all data access; this facade only wires locale, styles, and the slot.
 *
 * @module @local/dsh-mcp-skill-manager/client
 */

import * as React from 'react';
import en from '../../locale/en.json' with { type: 'json' };
import zh from '../../locale/zh.json' with { type: 'json' };
import { LOCALE_NS, SETTINGS_ID, SETTINGS_ORDER } from '../shared/contract.js';
import { Container } from './Container.js';
import { installStyles } from './styles.js';

/** Services the browser half needs before it registers. */
export const inject = ['slots', 'locale'];

/** Register dictionaries, styles, and the settings section. */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', en.ui));
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', zh.ui));
  ctx.effect(() => installStyles());

  const t = ctx.locale.bind(LOCALE_NS);

  function McpSkillSettings() {
    return React.createElement(Container, { ctx, t });
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SETTINGS_ID,
    order: SETTINGS_ORDER,
    label: () => t('nav')
  }, McpSkillSettings));
}

export default { inject, apply };

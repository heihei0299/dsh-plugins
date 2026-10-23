/**
 * Browser entry for @local/dsh-lan-connect: one read-only settings row in
 * Settings → General that tells the operator what the LAN entry currently is
 * and what exposing it means.
 *
 * Data path (read-only, one source): the Host injects
 * `globalThis.__DSH_LAN_CONNECT__` through the structured index injection:
 *
 *   { entryUrl, host, port, protocol, loopback, lanAddresses: [{ name, address, bound }] }
 *
 * There is no token in that record and this bundle never asks for one. It does
 * not call the Host, read cookies or storage, use `location.href`, or compose
 * a login URL: the only link it presents verbatim is `entryUrl`, exactly as the
 * Host advertised it. LAN rows are explicitly labelled *suggestions* built by
 * swapping only the host of `entryUrl`; this card does not probe reachability.
 *
 * A missing or malformed record renders an "unavailable" notice rather than a
 * guessed address. Clipboard success is only reported after the write resolves;
 * on plain HTTP (no Clipboard API) or a failed write the link is selected and
 * the operator is told to copy it manually.
 *
 * This file is the entry facade: it keeps the registration, the constants and
 * the test-facing exports stable while the pure logic lives in `client/`.
 */

import * as React from 'react';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };
import { BOOTSTRAP_KEY, ENTRY_PATH, isPrivateIPv4 } from './shared/contract.js';
import { LOCALE_NS, SETTINGS_ID, SETTINGS_ORDER, SETTINGS_SLOT } from './client/constants.js';
import { lanSuggestUrl, readBootstrap } from './client/bootstrap.js';
import { LanConnectCard } from './client/components.js';

export { BOOTSTRAP_KEY, ENTRY_PATH, isPrivateIPv4 };
export { LOCALE_NS, SETTINGS_ID, SETTINGS_ORDER, SETTINGS_SLOT };
export { lanSuggestUrl, readBootstrap };
export { LanConnectCard };
export { copyEntryLink, copyLinkText, selectLinkText, writeLinkText } from './client/clipboard.js';
export { createQrDataUrl } from './client/qr.js';

/** Services the browser half needs before it registers. */
export const inject = ['slots', 'locale'];

/**
 * Re-render the row when the active language (or a late dictionary) changes.
 * The bound translate function reads the active locale at call time, so the
 * subscription only has to trigger a render.
 * @param locale - the host LocaleRuntime.
 */
function useLocaleRevision(locale) {
  const subscribe = React.useCallback(listener => locale.subscribe(listener), [locale]);
  const getSnapshot = React.useCallback(() => locale.getSnapshot(), [locale]);
  React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Register the locale dictionaries and the General-settings row.
 *
 * Both registrations ride `ctx.effect`, so disabling the plugin removes the
 * dictionaries and the slot entry in one pass. The row reads the Host's global
 * at render time and never persists or fetches anything.
 * @param ctx - client root context with `slots` and `locale`.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', en.ui));
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', zh.ui));

  const t = ctx.locale.bind(LOCALE_NS);

  /** Settings row wrapper: re-reads the injected global on every render. */
  function LanConnectSettings() {
    useLocaleRevision(ctx.locale);
    const bootstrap = readBootstrap(globalThis[BOOTSTRAP_KEY]);
    return React.createElement(LanConnectCard, { t, bootstrap });
  }

  ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({
    name: SETTINGS_SLOT,
    id: SETTINGS_ID,
    order: SETTINGS_ORDER,
  }, LanConnectSettings));
}

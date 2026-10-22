/**
 * Browser half for @local/dsh-lan-connect: one read-only settings row in
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
 * Styling is inline and uses only the host's native `--dsw-*` design tokens, so
 * nothing global is injected and narrow settings columns cannot overflow.
 *
 * The module is bundled to CJS and wrapped by scripts/build.mjs as
 * `window.__ModuleLoader__.load({ id, factory(require) })`; React comes from the
 * host's require table and qrcode-generator is bundled locally.
 */

import * as React from 'react';
import qrcode from 'qrcode-generator';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };

/** Locale namespace registered by this plugin (also its locale file family). */
export const LOCALE_NS = 'dsh-lan-connect';
/** Additive General-settings row: the section supplies no props of its own. */
export const SETTINGS_SLOT = 'settings.general.item';
/** Slot row identity shown in Settings → General. */
export const SETTINGS_ID = 'dsh-lan-connect';
/** Row position: after Appearance/Composer (80/85) and before later rows. */
export const SETTINGS_ORDER = 90;
/** Global injected by the Host's structured index injection. */
export const BOOTSTRAP_KEY = '__DSH_LAN_CONNECT__';

/** Services the browser half needs before it registers. */
export const inject = ['slots', 'locale'];

/** Entry path the Host always appends to its advertised root. */
const ENTRY_PATH = '/lan';

/**
 * Whether one string is a dotted-quad IPv4 literal.
 * @param value - candidate address text.
 * @returns true for exactly four decimal octets in range.
 */
function isIPv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Whether one IPv4 literal is a private (RFC 1918) LAN address.
 * @param value - dotted-quad address.
 * @returns true for 10/8, 172.16/12, or 192.168/16.
 */
function isPrivateIPv4(value) {
  if (!isIPv4(value)) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Whether an advertised URL hostname is the loopback authority.
 * @param hostname - WHATWG URL hostname (IPv6 literals keep brackets).
 * @returns true for localhost, ::1, or any 127/8 literal.
 */
function isLoopbackHostname(hostname) {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/** Inline styles: native host tokens only, with readable fallbacks. */
const STYLE = Object.freeze({
  root: Object.freeze({
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '13px',
    lineHeight: '20px',
  }),
  section: Object.freeze({
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
    maxWidth: '100%',
  }),
  title: Object.freeze({
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary, #1f2328)',
  }),
  label: Object.freeze({
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-secondary, #57606a)',
  }),
  caption: Object.freeze({
    margin: 0,
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-secondary, #57606a)',
    overflowWrap: 'anywhere',
  }),
  security: Object.freeze({
    margin: 0,
    padding: '8px 10px',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: 'var(--dsw-radius-md, 6px)',
    background: 'var(--dsw-alias-bg-layer-1, #f6f8fa)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '12px',
    lineHeight: '18px',
    overflowWrap: 'anywhere',
  }),
  warn: Object.freeze({
    margin: 0,
    padding: '8px 10px',
    border: '1px solid var(--dsw-alias-state-warn-primary, #b45309)',
    borderRadius: 'var(--dsw-radius-md, 6px)',
    background: 'var(--dsw-alias-bg-layer-1, #f6f8fa)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '12px',
    lineHeight: '18px',
    overflowWrap: 'anywhere',
  }),
  notice: Object.freeze({
    margin: 0,
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-secondary, #57606a)',
    overflowWrap: 'anywhere',
  }),
  fieldRow: Object.freeze({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    maxWidth: '100%',
  }),
  input: Object.freeze({
    // A settings column can be very narrow on phones. Take a full line so the
    // read-only URL never shares a row with the button, then wrap the button.
    flex: '1 1 100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: 'var(--dsw-radius-md, 6px)',
    background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '18px',
  }),
  button: Object.freeze({
    flex: '0 0 auto',
    padding: '4px 10px',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: 'var(--dsw-radius-md, 6px)',
    background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '12px',
    lineHeight: '18px',
    cursor: 'pointer',
  }),
  facts: Object.freeze({
    // One stacked pair per fact: a two-column grid collapses into unreadable
    // slivers in the narrow Settings column on a phone.
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '6px',
    minWidth: 0,
    maxWidth: '100%',
  }),
  fact: Object.freeze({
    display: 'grid',
    gap: '1px',
    minWidth: 0,
  }),
  factLabel: Object.freeze({
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-secondary, #57606a)',
  }),
  factValue: Object.freeze({
    minWidth: 0,
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    overflowWrap: 'anywhere',
  }),
  candidate: Object.freeze({
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: 'var(--dsw-radius-md, 6px)',
    background: 'var(--dsw-alias-bg-layer-1, #f6f8fa)',
  }),
  candidateHead: Object.freeze({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '6px',
    minWidth: 0,
  }),
  candidateName: Object.freeze({
    minWidth: 0,
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    overflowWrap: 'anywhere',
  }),
  badge: Object.freeze({
    flex: '0 0 auto',
    padding: '0 6px',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: '999px',
    color: 'var(--dsw-alias-label-secondary, #57606a)',
    fontSize: '11px',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  }),
  qr: Object.freeze({
    display: 'block',
    width: '144px',
    maxWidth: '100%',
    height: 'auto',
    boxSizing: 'border-box',
    padding: '8px',
    background: '#ffffff',
    border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
    borderRadius: 'var(--dsw-radius-md, 6px)',
  }),
});

/**
 * Whether one value is a plain record (not null, not an array).
 * @param value - candidate bootstrap member.
 * @returns true for an object record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an absolute HTTP(S) URL without throwing.
 * @param value - candidate URL string.
 * @returns the parsed URL, or null when absent, relative, or non-HTTP(S).
 */
function parseHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Narrow the Host's injected record onto the shape this card renders.
 *
 * Unknown or inconsistent records produce null — the card then shows an
 * "unavailable" notice instead of a guessed entry URL. Individual malformed
 * LAN entries are dropped rather than inventing fields for them.
 * @param value - `globalThis.__DSH_LAN_CONNECT__`, which is untrusted input.
 * @returns a frozen record, or null when the record cannot be displayed.
 */
export function readBootstrap(value) {
  if (!isRecord(value)) return null;
  const { entryUrl, host, port, protocol, loopback, lanAddresses } = value;
  const entry = parseHttpUrl(entryUrl);
  if (entry === null) return null;
  // The Host publishes a clean entry URL. Never present credentials, a query,
  // a fragment, or an unknown path if the global was tampered with.
  if (entry.username !== '' || entry.password !== '' || entry.search !== '' || entry.hash !== '') return null;
  if (!entry.pathname.endsWith(ENTRY_PATH)) return null;
  if (typeof host !== 'string' || host.trim() === '') return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  // The advertised root may be an HTTPS proxy in front of a plain-HTTP
  // listener, so the entry scheme and the listener protocol may differ.
  if (typeof loopback !== 'boolean') return null;
  if (!Array.isArray(lanAddresses)) return null;
  const candidates = [];
  for (const candidate of lanAddresses) {
    if (!isRecord(candidate)) continue;
    const { name, address, bound } = candidate;
    if (typeof name !== 'string' || name.trim() === '') continue;
    // The Host publishes RFC 1918 IPv4 candidates only; anything else is not
    // an address this card may present as a LAN suggestion.
    if (typeof address !== 'string' || !isPrivateIPv4(address.trim())) continue;
    if (typeof bound !== 'boolean') continue;
    candidates.push(Object.freeze({ name: name.trim(), address: address.trim(), bound }));
  }
  // The listener and the advertised entry need not share an authority: a
  // trusted proxy may publish a LAN/HTTPS root while DSH itself listens on
  // loopback. Reachability follows the entry, not the internal listener.
  const advertisedPort = entry.port === '' ? (entry.protocol === 'https:' ? 443 : 80) : Number(entry.port);
  if (!Number.isInteger(advertisedPort) || advertisedPort < 1 || advertisedPort > 65535) return null;
  return Object.freeze({
    entryUrl: entry.href,
    host: host.trim(),
    port,
    protocol,
    loopback,
    advertisedHost: entry.hostname,
    advertisedPort,
    advertisedProtocol: entry.protocol,
    advertisedLoopback: isLoopbackHostname(entry.hostname),
    lanAddresses: Object.freeze(candidates),
  });
}

/**
 * Suggest the entry URL on one LAN address by replacing only its host.
 *
 * The suggestion keeps the entry's own scheme, port, and path and is never
 * shown as reachable: the card labels every candidate as an unverified
 * suggestion. Only a validated private IPv4 literal is accepted, so an
 * arbitrary or malformed value cannot forge a different URL shape.
 * @param bootstrap - normalized record from {@link readBootstrap}.
 * @param address - candidate interface address.
 * @returns the suggested absolute URL, or null when none can be composed.
 */
export function lanSuggestUrl(bootstrap, address) {
  if (!isRecord(bootstrap)) return null;
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!isPrivateIPv4(trimmed)) return null;
  const entry = parseHttpUrl(bootstrap.entryUrl);
  if (entry === null) return null;
  if (entry.username !== '' || entry.password !== '' || entry.search !== '' || entry.hash !== '') return null;
  const authority = entry.port === '' ? trimmed : `${trimmed}:${entry.port}`;
  const path = entry.pathname === '' ? '/' : entry.pathname;
  return `${entry.protocol}//${authority}${path}`;
}

/**
 * Copy one URL through the Clipboard API.
 * @param value - URL text.
 * @returns 'copied', 'unavailable' (no API, e.g. plain HTTP), or 'rejected'.
 */
export async function writeLinkText(value) {
  if (typeof value !== 'string' || value === '') return 'rejected';
  let clipboard;
  try {
    clipboard = globalThis.navigator?.clipboard;
  } catch {
    return 'unavailable';
  }
  if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== 'function') return 'unavailable';
  try {
    await clipboard.writeText(value);
    return 'copied';
  } catch {
    return 'rejected';
  }
}

/**
 * Boolean form of {@link writeLinkText}.
 * @param value - URL text.
 * @returns true only when the write actually resolved.
 */
export async function copyLinkText(value) {
  return await writeLinkText(value) === 'copied';
}

/**
 * Select a read-only link field as the manual-copy fallback.
 * @param input - the field element, when mounted.
 * @returns true when the text was selected.
 */
export function selectLinkText(input) {
  if (input === null || input === undefined) return false;
  try {
    input.focus();
    input.select();
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(0, input.value.length);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy one link, or select it for manual copying when that is all the browser
 * allows. The returned key is the exact notice the row shows; success is never
 * claimed for a rejected Clipboard API write.
 * @param value - URL text.
 * @param input - the read-only field element, when mounted.
 * @returns the locale key describing the outcome.
 */
export async function copyEntryLink(value, input) {
  const outcome = await writeLinkText(value);
  if (outcome === 'copied') return 'copy.copied';
  if (!selectLinkText(input)) return 'copy.failed';
  return outcome === 'unavailable' ? 'copy.unavailable' : 'copy.manual';
}

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
 * One read-only URL field with a copy button.
 *
 * Success is reported only after `writeText` resolves. When the Clipboard API
 * is absent (plain HTTP) or the write rejects, the field is selected and the
 * notice asks for a manual copy; no success is ever claimed.
 * @param props - URL, labels, translator, and a stable test id prefix.
 * @returns the field block.
 */
function CopyableLink({ t, url, label, copyLabel, testId }) {
  const inputRef = React.useRef(null);
  const [notice, setNotice] = React.useState(null);

  React.useEffect(() => {
    setNotice(null);
  }, [url]);

  async function copy() {
    setNotice(await copyEntryLink(url, inputRef.current));
  }

  const children = [
    React.createElement('div', { key: 'label', style: STYLE.label }, label),
    React.createElement('div', { key: 'field', style: STYLE.fieldRow },
      React.createElement('input', {
        ref: inputRef,
        type: 'text',
        readOnly: true,
        value: url,
        'aria-label': label,
        spellCheck: false,
        autoComplete: 'off',
        'data-lan-connect': `${testId}-input`,
        onFocus: event => { event.currentTarget.select(); },
        style: STYLE.input,
      }),
      React.createElement('button', {
        type: 'button',
        'data-lan-connect': `${testId}-copy`,
        'aria-label': copyLabel,
        onClick: () => { void copy(); },
        style: STYLE.button,
      }, t('entry.copy')),
    ),
  ];
  if (notice !== null) {
    children.push(React.createElement('p', {
      key: 'notice',
      role: 'status',
      'data-lan-connect': `${testId}-notice`,
      style: STYLE.notice,
    }, t(notice)));
  }
  return React.createElement('div', { 'data-lan-connect': testId, style: STYLE.section }, ...children);
}

/**
 * Encode one URL as a local QR data URL.
 *
 * qrcode-generator runs in this bundle and returns a GIF data URL; no external
 * image URL, HTML string, or network request is involved. Null means the input
 * was absent or encoding failed, and the card then renders text instead.
 * @param value - entry URL to encode.
 * @returns a data URL, or null on absent/invalid input or encoder failure.
 */
export function createQrDataUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    return code.createDataURL(4, 8);
  } catch {
    return null;
  }
}

/**
 * Local QR code for the entry link.
 *
 * The image is a data URL produced in-process by qrcode-generator; no external
 * image URL, no HTML string, and no network request is involved. A failure
 * renders text instead of an empty placeholder.
 * @param props - entry URL, loopback flag, and translator.
 * @returns the QR block.
 */
function QrBlock({ t, url, loopback }) {
  const dataUrl = React.useMemo(() => createQrDataUrl(url), [url]);

  const children = [
    React.createElement('div', { key: 'title', style: STYLE.label }, t('qr.title')),
    dataUrl === null
      ? React.createElement('p', { key: 'failed', role: 'status', 'data-lan-connect': 'qr-failed', style: STYLE.warn }, t('qr.failed'))
      : React.createElement('img', {
        key: 'image',
        src: dataUrl,
        alt: t('qr.alt'),
        width: 144,
        height: 144,
        'data-lan-connect': 'qr-image',
        style: STYLE.qr,
      }),
    React.createElement('p', { key: 'caption', style: STYLE.caption }, t(loopback ? 'qr.caption.loopback' : 'qr.caption')),
  ];
  return React.createElement('div', { 'data-lan-connect': 'qr', style: STYLE.section }, ...children);
}

/**
 * Listener facts: the actual bound host, port, and protocol.
 * @param props - normalized bootstrap and translator.
 * @returns the facts block.
 */
function Facts({ t, bootstrap }) {
  const rows = [
    ['entry.advertisedHost', bootstrap.advertisedHost],
    ['entry.advertisedPort', String(bootstrap.advertisedPort)],
    ['entry.advertisedProtocol', bootstrap.advertisedProtocol.replace(':', '')],
    ['entry.listener', `${bootstrap.host}:${bootstrap.port} (${bootstrap.protocol.replace(':', '')})`],
  ].map(([key, value]) => React.createElement('div', { key, style: STYLE.fact },
    React.createElement('span', { style: STYLE.factLabel }, t(key)),
    React.createElement('span', { style: STYLE.factValue }, value),
  ));
  return React.createElement('div', { 'data-lan-connect': 'facts', style: STYLE.facts }, ...rows);
}

/**
 * LAN candidates reported by the Host, never presented as verified access.
 * @param props - normalized bootstrap and translator.
 * @returns the LAN block.
 */
function LanList({ t, bootstrap }) {
  const children = [
    React.createElement('div', { key: 'title', style: STYLE.label }, t('lan.title')),
    React.createElement('p', { key: 'caption', style: STYLE.caption }, t('lan.caption')),
  ];
  if (bootstrap.lanAddresses.length === 0) {
    children.push(React.createElement('p', { key: 'empty', style: STYLE.caption }, t('lan.empty')));
    return React.createElement('div', { 'data-lan-connect': 'lan', style: STYLE.section }, ...children);
  }
  bootstrap.lanAddresses.forEach((candidate, index) => {
    const suggested = lanSuggestUrl(bootstrap, candidate.address);
    const head = React.createElement('div', { key: 'head', style: STYLE.candidateHead },
      React.createElement('span', { style: STYLE.candidateName }, candidate.name),
      React.createElement('span', { style: STYLE.badge }, t(
        candidate.address === bootstrap.advertisedHost ? 'lan.entry' : candidate.bound ? 'lan.bound' : 'lan.unbound',
      )),
    );
    const body = suggested === null
      ? React.createElement('p', { key: 'address', style: STYLE.caption }, `${candidate.address} — ${t('lan.noLink')}`)
      : React.createElement(CopyableLink, {
        key: 'link',
        t,
        url: suggested,
        label: t('lan.urlLabel'),
        copyLabel: `${t('lan.copyLabel')} (${candidate.address})`,
        testId: `lan-${index}`,
      });
    children.push(React.createElement('div', {
      key: `candidate-${index}`,
      'data-lan-connect': 'lan-candidate',
      style: STYLE.candidate,
    }, head, body));
  });
  return React.createElement('div', { 'data-lan-connect': 'lan', style: STYLE.section }, ...children);
}

/**
 * The settings row, pure in its inputs: everything it shows comes from the
 * normalized bootstrap and the translator. It owns no store and no Host call.
 * @param props - `t` dictionary lookup and a normalized bootstrap (null when unknown).
 * @returns the settings row.
 */
export function LanConnectCard({ t: translate, bootstrap = null } = {}) {
  const t = typeof translate === 'function' ? translate : key => key;
  const blocks = [
    React.createElement('div', { key: 'header', style: STYLE.section },
      React.createElement('div', { style: STYLE.title }, t('settings.title')),
      React.createElement('p', { style: STYLE.caption }, t('settings.description')),
    ),
    React.createElement('p', {
      key: 'permissions',
      'data-lan-connect': 'permissions',
      style: STYLE.security,
    }, t('notice.permissions')),
  ];
  if (bootstrap === null || bootstrap === undefined) {
    blocks.push(React.createElement('div', {
      key: 'unavailable',
      role: 'status',
      'data-lan-connect': 'unavailable',
      style: STYLE.section,
    },
    React.createElement('div', { style: STYLE.label }, t('unavailable.title')),
    React.createElement('p', { style: STYLE.warn }, t('unavailable.bootstrap')),
    React.createElement('p', { style: STYLE.caption }, t('unavailable.hint')),
    ));
  } else {
    blocks.push(
      React.createElement(CopyableLink, {
        key: 'entry',
        t,
        url: bootstrap.entryUrl,
        label: t('entry.normal'),
        copyLabel: t('entry.copyLabel'),
        testId: 'entry-normal',
      }),
      React.createElement(Facts, { key: 'facts', t, bootstrap }),
      // Warnings follow the entry other devices actually open, not the
      // internal listener: an HTTPS proxy in front of a loopback listener is
      // reachable and encrypted on the browser hop.
      bootstrap.advertisedProtocol === 'http:'
        ? React.createElement('p', {
          key: 'http',
          role: 'note',
          'data-lan-connect': 'warn-http',
          style: STYLE.warn,
        }, t('warn.http'))
        : null,
      bootstrap.advertisedLoopback
        ? React.createElement('div', {
          key: 'loopback',
          'data-lan-connect': 'warn-loopback',
          style: STYLE.section,
        },
        React.createElement('p', { style: STYLE.warn }, t('warn.loopback')),
        React.createElement('p', { style: STYLE.caption }, t('warn.loopback.hint')),
        )
        : null,
      bootstrap.loopback && !bootstrap.advertisedLoopback
        ? React.createElement('p', {
          key: 'proxy',
          role: 'note',
          'data-lan-connect': 'info-proxy',
          style: STYLE.caption,
        }, t('entry.proxy'))
        : null,
      React.createElement(QrBlock, { key: 'qr', t, url: bootstrap.entryUrl, loopback: bootstrap.advertisedLoopback }),
      React.createElement(LanList, { key: 'lan', t, bootstrap }),
    );
  }
  blocks.push(React.createElement('p', {
    key: 'cookies',
    'data-lan-connect': 'cookies',
    style: STYLE.caption,
  }, t('notice.cookies')));

  const visible = blocks.filter(block => block !== null);
  return React.createElement('section', {
    'data-plugin': SETTINGS_ID,
    'data-lan-connect': 'root',
    'aria-label': t('settings.title'),
    style: STYLE.root,
  }, ...visible);
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

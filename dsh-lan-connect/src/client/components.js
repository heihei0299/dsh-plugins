import * as React from 'react';
import { SETTINGS_ID } from './constants.js';
import { STYLE } from './styles.js';
import { createQrDataUrl } from './qr.js';
import { lanSuggestUrl } from './bootstrap.js';
import { copyEntryLink } from './clipboard.js';

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

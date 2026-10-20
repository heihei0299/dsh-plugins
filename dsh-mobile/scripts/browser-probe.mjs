import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';

/**
 * Read-only probe for the DSH mobile acceptance checklist.
 *
 * Connects to an ALREADY RUNNING Chrome remote-debugging endpoint, measures the
 * page's layout at a given viewport, and prints one JSON report. It never
 * starts Chrome, never reads credentials, never patches page state, and always
 * restores the emulation it applied.
 *
 * Usage:
 *   node scripts/browser-probe.mjs http://127.0.0.1:9222 [--viewport 390x844] [--app http://127.0.0.1:50020] [--target <id>]
 */

const DEFAULT_APP_ORIGIN = process.env.DSH_APP_ORIGIN || 'http://127.0.0.1:50020';
const USAGE = [
  'Usage: node scripts/browser-probe.mjs http://HOST:PORT [options]',
  '  --viewport WxH   emulate a viewport for the measurement (default 390x844)',
  '  --app ORIGIN     DSH page origin (default http://127.0.0.1:50020)',
  '  --target ID      pick one DSH tab instead of the only one',
  '  --touch          emulate a coarse pointer while measuring',
  'Connects only to an already-running Chrome CDP endpoint; never starts Chrome or reads credentials.',
].join('\n');

export function debugBase(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Provide an HTTP(S) debug address without credentials, query strings or fragments.');
  }
  if (!['/', '/json/version', '/json/list'].includes(url.pathname)) throw new Error('Expected a Chrome remote-debugging HTTP address.');
  url.pathname = '/';
  return url;
}

export function dshTargets(targets, origin = DEFAULT_APP_ORIGIN) {
  if (!Array.isArray(targets)) throw new Error('Chrome /json/list did not return an array.');
  return targets.filter(target => {
    try {
      return target?.type === 'page' && new URL(target.url).origin === origin && typeof target.webSocketDebuggerUrl === 'string';
    } catch { return false; }
  });
}

export function pageSocket(base, target) {
  const advertised = new URL(target.webSocketDebuggerUrl);
  if (!['ws:', 'wss:'].includes(advertised.protocol) || !advertised.pathname.startsWith('/devtools/page/')) throw new Error('Invalid page debugging endpoint.');
  const socket = new URL(base);
  socket.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  socket.pathname = advertised.pathname;
  return socket;
}

/** Parse `--viewport 390x844` into device-metrics arguments. */
export function parseViewport(value) {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value ?? '');
  if (match === null) throw new Error(`Expected WIDTHxHEIGHT, received ${JSON.stringify(value)}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 200 || height < 200) throw new Error('Refusing a viewport smaller than 200x200.');
  return { width, height };
}

async function json(base, path) {
  return new Promise((resolve, reject) => {
    const transport = base.protocol === 'https:' ? https : http;
    const request = transport.get(new URL(path, base), { agent: false }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Debug endpoint returned HTTP ${response.statusCode}; no authentication workaround will be attempted.`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1_048_576) { request.destroy(new Error('Unexpectedly large debugging response.')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error('Debug connection timed out.')));
    request.on('error', reject);
  });
}

export async function connectPage(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const failPending = message => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    pending.clear();
  };
  socket.addEventListener('close', () => failPending('Chrome debugging connection closed.'));
  socket.addEventListener('error', () => failPending('Chrome debugging connection failed.'));
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Chrome connection timed out.')); }, 5_000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Unable to connect to Chrome.')); }, { once: true });
    socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Chrome closed before connecting.')); }, { once: true });
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out.`)); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() { failPending('Probe completed.'); socket.close(); },
  };
}

/** Everything the acceptance checklist asserts, evaluated inside the page. */
const MEASURE = String.raw`(() => {
  const q = selector => Array.from(document.querySelectorAll(selector));
  const size = element => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  };
  const frame = document.querySelector('[data-slot="root"] > div');
  const composer = q('[data-composer-card] button');
  const actions = q('[data-actions-reveal] button');
  const tabs = q('[data-conversation-tabs] button');
  const minimum = nodes => nodes.length === 0 ? null : Math.min(...nodes.map(node => Math.min(size(node).width, size(node).height)));
  const wideTables = q('.md-table-wide');
  const scrollport = document.querySelector('[data-conversation-scroll]');
  const meta = document.querySelector('meta[name="viewport"]');
  return {
    origin: location.origin,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    coarse: matchMedia('(pointer: coarse)').matches,
    rootAttribute: document.documentElement.getAttribute('data-dsh-mobile'),
    frameColumns: frame === null ? null : getComputedStyle(frame).gridTemplateColumns,
    frameHeight: frame === null ? null : Math.round(frame.getBoundingClientRect().height),
    rootHeight: Math.round(document.getElementById('root').getBoundingClientRect().height),
    pageOverflowX: document.scrollingElement.scrollWidth - innerWidth,
    drawer: {
      toggle: q('.dsh-mobile-toggle').map(size),
      scrim: q('.dsh-mobile-scrim').length,
      sidebar: q('[data-slot="root"] > div > div:has(> [data-slot="sidebar"])').map(size),
      collapsed: frame === null ? null : frame.hasAttribute('data-sidebar-collapsed'),
    },
    tapTargets: {
      composer: minimum(composer),
      messageActions: minimum(actions),
      viewTabs: minimum(tabs),
    },
    wideTable: wideTables.length === 0 ? null : {
      count: wideTables.length,
      overflowing: wideTables.some(table => table.scrollWidth > table.clientWidth + 1),
      overflowX: getComputedStyle(wideTables[0]).overflowX,
      touchAction: getComputedStyle(wideTables[0]).touchAction,
    },
    keyboardInset: getComputedStyle(document.documentElement).getPropertyValue('--dsh-mobile-kb-inset').trim() || null,
    scrollOverscroll: scrollport === null ? null : getComputedStyle(scrollport).overscrollBehaviorY,
    settingsRow: q('.dsh-mobile-settings').length,
    viewportMeta: meta === null ? null : meta.getAttribute('content'),
    styleTags: q('style[data-plugin-css^="@local/dsh-mobile"]').length,
    crashes: q('[data-slot-error]').length,
  };
})()`;

/**
 * Measure one DSH tab at one viewport, restoring emulation afterwards.
 * @param input - Chrome debugging HTTP address.
 * @param options - viewport, app origin, target id and pointer mode.
 * @returns the report.
 */
export async function probe(input, options = {}) {
  const base = debugBase(input);
  const appOrigin = options.appOrigin ?? DEFAULT_APP_ORIGIN;
  const version = await json(base, 'json/version');
  const targets = dshTargets(await json(base, 'json/list'), appOrigin);
  const matches = options.targetId === undefined ? targets : targets.filter(target => target.id === options.targetId);
  if (matches.length !== 1) {
    return {
      connected: true, browser: version.Browser, needsTarget: true,
      matchingDshTabs: targets.map(target => target.id),
      nextStep: matches.length === 0
        ? 'Open the existing DSH page in this debugging-enabled Chrome and sign in manually if needed.'
        : 'More than one DSH tab is open; pass --target <id>.',
    };
  }
  const page = await connectPage(pageSocket(base, matches[0]));
  const applied = options.viewport !== undefined;
  try {
    if (applied) {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width: options.viewport.width, height: options.viewport.height, deviceScaleFactor: 2, mobile: true,
      });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: options.touch === true, maxTouchPoints: 5 });
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const result = await page.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
    if (result.exceptionDetails) throw new Error('Page evaluation failed; page text and credentials were not collected.');
    return { connected: true, browser: version.Browser, targetId: matches[0].id, page: result.result?.value, readOnly: true };
  } finally {
    if (applied) {
      await page.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
    }
    page.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const option = name => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  if (argv.length === 0 || argv.includes('--help') || argv[0] === '--help') {
    console.log(USAGE);
    if (argv.length === 0) process.exitCode = 2;
  } else {
    try {
      const report = await probe(argv[0], {
        viewport: parseViewport(option('--viewport') ?? '390x844'),
        appOrigin: option('--app'),
        targetId: option('--target'),
        touch: argv.includes('--touch'),
      });
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Chrome probe failed.');
      process.exitCode = 1;
    }
  }
}

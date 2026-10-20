import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const DEFAULT_APP_ORIGIN = process.env.DSH_APP_ORIGIN || 'http://127.0.0.1:50020';
const USAGE = 'Usage: node scripts/browser-probe.mjs http://HOST:PORT [TARGET_ID] [APP_ORIGIN]\nDefault APP_ORIGIN is http://127.0.0.1:50020 (override with the third argument or DSH_APP_ORIGIN).\nConnects only to an already-running Chrome CDP endpoint; never starts Chrome or reads credentials.';
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
    try { return target?.type === 'page' && new URL(target.url).origin === origin && typeof target.webSocketDebuggerUrl === 'string'; }
    catch { return false; }
  });
}
export function pageSocket(base, target) {
  const advertised = new URL(target.webSocketDebuggerUrl);
  if (!['ws:', 'wss:'].includes(advertised.protocol) || !advertised.pathname.startsWith('/devtools/page/')) throw new Error('Invalid page debugging endpoint.');
  // Chrome can advertise localhost even when the user provided a remote address.
  const socket = new URL(base);
  socket.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  socket.pathname = advertised.pathname;
  return socket;
}
async function json(base, path) {
  // This is an explicitly supplied debugging socket, not a Web request routed through an environment proxy.
  return new Promise((resolve, reject) => {
    const transport = base.protocol === 'https:' ? https : http;
    const request = transport.get(new URL(path, base), { agent: false }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Debug endpoint returned HTTP ${response.statusCode}; no authentication workaround will be attempted.`));
        return;
      }
      const chunks = []; let size = 0;
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
  const pending = new Map(); let nextId = 1;
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
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Chrome connection timed out.')); }, 5_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Unable to connect to Chrome.')); }, { once: true });
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Chrome closed before connecting.')); }, { once: true });
    });
  } catch (error) { socket.close(); throw error; }
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out.`)); }, 5_000);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() { failPending('Probe completed.'); socket.close(); },
  };
}
export async function probe(input, targetId, appOrigin = DEFAULT_APP_ORIGIN) {
  const base = debugBase(input);
  const version = await json(base, 'json/version');
  const targets = dshTargets(await json(base, 'json/list'), appOrigin);
  const matches = targetId ? targets.filter(target => target.id === targetId) : targets;
  if (matches.length !== 1) {
    return { connected: true, browser: version.Browser, matchingDshTabs: targets.map(target => target.id), needsTarget: true,
      nextStep: matches.length ? 'More than one DSH tab is open; specify its target ID.' : 'Open the existing DSH page in this debugging-enabled Chrome and sign in manually if needed.' };
  }
  const page = await connectPage(pageSocket(base, matches[0]));
  try {
    const result = await page.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        if (location.origin !== ${JSON.stringify(appOrigin)}) throw new Error('The target navigated away from DSH.');
        const count = selector => document.querySelectorAll(selector).length;
        return {
          origin: location.origin,
          viewport: { width: innerWidth, height: innerHeight },
          smartuiRoots: count('.smartui-root'), settings: count('.smartui-settings'), suggestions: count('.smartui-launcher'),
          documents: count('.smartui-document'),
          blocks: Object.fromEntries(['card','table','chart','form','choices'].map(type => [type, count('.smartui-block-' + type)]))
        };
      })()`,
    });
    if (result.exceptionDetails) throw new Error('Page evaluation failed; page text and credentials were not collected.');
    return { connected: true, browser: version.Browser, targetId: matches[0].id, page: result.result?.value, readOnly: true };
  } finally { page.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || process.argv[2] === '--help') {
    console.log(USAGE); if (!process.argv[2]) process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await probe(process.argv[2], process.argv[3], process.argv[4]), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : 'Chrome probe failed.'); process.exitCode = 1; }
  }
}

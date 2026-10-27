import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional isolated browser regression: real built plugin, local tools only.
// No authentication, server, package installation or user session is involved.
const playwrightModule = process.env.DSH_MOBILE_PLAYWRIGHT_MODULE;
const executablePath = process.env.DSH_MOBILE_BROWSER_EXECUTABLE;
const require = createRequire(import.meta.url);

test('the status popup opens under its icon, inside every viewport, and every icon toggles it', {
  skip: !playwrightModule || !executablePath ? 'set local Playwright module and browser paths to run touch regression' : false,
}, async () => {
  const { chromium } = await import(pathToFileURL(playwrightModule).href);
  const reactPath = dirname(require.resolve('react'));
  const domPath = dirname(require.resolve('react-dom'));
  const schedulerPath = dirname(createRequire(require.resolve('react-dom/client')).resolve('scheduler'));
  const sources = Object.fromEntries(await Promise.all([
    ['react', join(reactPath, 'cjs/react.production.js')],
    ['react-dom', join(domPath, 'cjs/react-dom.production.js')],
    ['react-dom/client', join(domPath, 'cjs/react-dom-client.production.js')],
    ['scheduler', join(schedulerPath, 'cjs/scheduler.production.js')],
  ].map(async ([name, path]) => [name, await readFile(path, 'utf8')])));
  const plugin = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;font:14px system-ui,sans-serif;background:#fafafa;--dsw-specific-menu:#f8f9fa94;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-base:#fafafa;--dsw-alias-label-primary:#17212f;--dsw-alias-label-secondary:#667085;--dsw-alias-label-tertiary:#667085;--dsw-alias-interactive-bg-hover:#f2f4f7;--dsw-alias-border-l2:#e5e7eb}
      body[data-ds-dark-theme]{background:#181819;--dsw-specific-menu:#43454a73;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-base:#181819;--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#b7bdc8;--dsw-alias-label-tertiary:#aaa;--dsw-alias-interactive-bg-hover:#303033;--dsw-alias-border-l2:#3b3b3e}
      [data-slot]{display:contents}
      header.fixture-header{display:flex;align-items:center;justify-content:space-between;padding:12px;container-type:inline-size;overflow:hidden}
      .fixture-header strong{font-size:15px;color:var(--dsw-alias-label-primary)}
      .fixture-transcript{padding:24px;color:var(--dsw-alias-label-secondary);line-height:1.8}
      [data-composer-seat]{position:fixed;bottom:0;width:100%}
      [data-composer-card]{margin:16px;padding:28px 20px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:22px;color:var(--dsw-alias-label-secondary)}
      [data-composer-dock]{display:flex;justify-content:center;gap:12px}
      [data-composer-dock] button{min-height:20px;border:0;background:none;color:var(--dsw-alias-label-secondary)}
    </style></head><body><div id="root" data-slot="root"><div data-sidebar-collapsed>
      <div data-slot="conversation.header"><header class="fixture-header"><strong>移动端会话</strong><span data-slot="conversation.session.header.actions" id="badges"></span></header></div>
      <div class="fixture-transcript"><h2>图标锚定浮层预览</h2><p>这是隔离验证页面，不是登录态 GUI。浮层应紧贴顶部图标下方展开，不被头部 container-type 与 overflow:hidden 裁切，也没有整页遮罩。</p></div>
      <div data-composer-seat><div data-composer-card>发送消息或创建任务…</div><div data-composer-dock>
        <span data-composer-stat="activity"><button aria-haspopup="dialog" aria-expanded="false">20 turns</button></span>
        <span data-composer-stat="usage"><button aria-haspopup="dialog" aria-expanded="false">73.6M tok</button></span>
        <span><button aria-haspopup="dialog" aria-expanded="false">33%</button></span>
      </div></div></div></div></body></html>`);
    await page.evaluate(({ sources, plugin }) => {
      const cache = {};
      function require(name) {
        if (cache[name]) return cache[name].exports;
        if (!sources[name]) throw new Error(`Unexpected runtime import ${name}`);
        const module = cache[name] = { exports: {} };
        new Function('require', 'module', 'exports', 'process', sources[name])(require, module, module.exports, { env: { NODE_ENV: 'production' } });
        return module.exports;
      }
      let mobile;
      window.__ModuleLoader__ = { load: registration => { mobile = registration.factory(require); } };
      (0, eval)(plugin);
      const React = require('react');
      const components = new Map();
      const cleanups = [];
      const snapshot = { status: 'ready', value: { mode: 'on', drawerNavigation: true, comfortableTargets: true }, writable: true, revision: 1 };
      const formListeners = new Set();
      const source = value => ({ getSnapshot: () => value, subscribe: () => () => {} });
      const locales = new Map();
      let sessionState = { byId: {
        child: { running: true },
        review: { running: false, projectionValues: { subagentTiming: { settledMs: 1234, lastTurnCompleted: true } } },
        audit: { running: false },
      }, projectionsBySession: { parent: { values: { subagentCatalog: [
        { id: 'child', label: '检查移动端弹层布局与子代理对话跳转' },
        { id: 'review', label: '复核长任务名称、列表滚动与暗色主题' },
        { id: 'audit', label: '验证键盘焦点和触摸关闭交互' },
      ] } } } };
      const sessionListeners = new Set();
      const sessionSource = {
        getSnapshot: () => sessionState,
        subscribe: listener => { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
      };
      window.setSubagentState = (id, value) => {
        sessionState = { ...sessionState, byId: { ...sessionState.byId, [id]: value } };
        for (const listener of sessionListeners) listener();
      };
      window.openedSessions = [];
      const services = {
        slots: {
          inject: (_name, factory) => factory(),
          register: (options, component) => { components.set(options.id ?? options.name, component); return () => {}; },
        },
        locale: {
          register: (_ns, locale, dictionary) => { locales.set(locale, dictionary); return () => {}; },
          bind: () => (key, values) => {
            let text = locales.get('zh')[key] ?? key;
            for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{${name}}`, value);
            return text;
          },
          ...source({ active: 'zh', revision: 0 }),
        },
        configForms: { get: () => ({ getSnapshot: () => snapshot, subscribe: listener => { formListeners.add(listener); return () => formListeners.delete(listener); } }) },
        layout: { panelInfo: source({ activePanelId: null }), toggleSidebar() {} },
        sessions: { list: sessionSource },
        jobs: { state: source({ rows: { parent: Array.from({ length: 24 }, (_, index) => ({
          id: `build-${index}`,
          label: index === 0 ? 'node /tmp/dsh-mobile-check-very-long-background-task-command-and-viewport-regression.mjs'
            : index === 1 ? 'pnpm run typecheck — 检查移动端组件与类型'
            : index === 2 ? '触摸回归：复核子代理跳转和底部统计入口'
            : `后台任务 ${index + 1}：检查布局和交互`,
          status: index === 0 ? 'running' : index === 2 ? 'failed' : 'completed',
          progress: index === 0 ? '已检查 12 / 24 个移动端布局用例' : undefined,
        })) } }), watchRows: () => () => {} },
        uiWorkspace: { openSession: target => { window.openedSessions.push(target); } },
      };
      const ctx = new Proxy({ effect(factory) { const dispose = factory(); cleanups.push(dispose); return dispose; } }, {
        get(target, name) {
          if (name in target) return target[name];
          if (!mobile.inject.includes(name)) throw new Error(`cannot get property "${name}" without inject`);
          return services[name];
        },
      });
      mobile.apply(ctx);
      const root = require('react-dom/client').createRoot(document.getElementById('badges'));
      const render = sessionId => root.render(React.createElement(components.get('dsh-mobile-status'), { sessionId }));
      render('parent');
      document.querySelectorAll('[data-composer-dock] button').forEach(button => {
        button.onclick = () => button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') === 'false' ? 'true' : 'false');
      });
      window.changeSession = sessionId => render(sessionId);
      window.disableMobile = () => { snapshot.value.mode = 'off'; for (const listener of formListeners) listener(); };
      window.disposeMobile = () => { root.unmount(); cleanups.reverse().forEach(dispose => dispose()); };
      window.openPopovers = () => document.querySelectorAll(':popover-open').length;
    }, { sources, plugin });

    const panel = page.locator('.dsh-mobile-badge-panel');
    const close = page.getByRole('button', { name: '关闭面板' });
    const trigger = kind => page.locator(`.dsh-mobile-badge-${kind}`);
    const openPanel = async kind => {
      await trigger(kind).tap();
      await panel.waitFor({ state: 'visible' });
    };
    const shot = async (kind, dark, viewport) => {
      if (!process.env.DSH_MOBILE_SCREENSHOT_DIR) return;
      await page.screenshot({ path: join(process.env.DSH_MOBILE_SCREENSHOT_DIR, `status-${kind}-${dark ? 'dark' : 'light'}-${viewport.width}x${viewport.height}.png`) });
    };

    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      for (const [dark, expected] of [[false, 'rgb(255, 255, 255)'], [true, 'rgb(35, 35, 36)']]) {
        await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark);
        for (const kind of ['subagents', 'jobs']) {
          await openPanel(kind);
          const anchor = await trigger(kind).boundingBox();
          const layout = await panel.evaluate(popup => {
            const box = popup.getBoundingClientRect();
            const list = popup.querySelector('ul');
            const style = getComputedStyle(popup);
            return {
              x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
              position: style.position,
              background: style.backgroundColor,
              backdrop: getComputedStyle(popup, '::backdrop').backgroundColor,
              topLayer: popup.matches(':popover-open'),
              modal: popup.matches(':modal'),
              overflowX: popup.scrollWidth > popup.clientWidth + 1,
              scrollable: list.scrollHeight > list.clientHeight,
              focusedInside: popup.contains(document.activeElement),
              labelWrap: getComputedStyle(popup.querySelector('.dsh-mobile-badge-row-label')).whiteSpace,
              hitTest: (() => { const hit = document.elementFromPoint(box.x + box.width / 2, box.y + 12); return hit !== null && popup.contains(hit); })(),
              closeHit: getComputedStyle(popup.querySelector('.dsh-mobile-badge-panel-close'), '::after').inset,
            };
          });
          assert.equal(layout.background, expected, `${kind} ${viewport.width}x${viewport.height} keeps an opaque theme surface`);
          assert.equal(layout.backdrop, 'rgba(0, 0, 0, 0)', 'no dimming backdrop: the page behind is never covered');
          assert.equal(layout.position, 'fixed');
          assert.equal(layout.topLayer, true, 'the native popover escapes the clipped header');
          assert.equal(layout.modal, false, 'a popover must never become a modal sheet');
          // Anchored directly under the icon, with the documented 8px gap.
          assert.ok(anchor !== null);
          assert.ok(Math.abs(layout.y - (anchor.y + anchor.height + 8)) <= 1.5, `popup hangs 8px under ${kind}: ${layout.y} vs ${anchor.y + anchor.height + 8}`);
          assert.ok(layout.y > anchor.y + anchor.height, 'the popup never covers its own icon');
          assert.ok(layout.y < viewport.height / 2, 'never pinned to the screen bottom');
          assert.ok(layout.width <= 361, 'menu-sized card, not a screen-wide panel');
          assert.ok(layout.x >= 11 && layout.right <= viewport.width - 11, 'never escapes the left/right edge');
          assert.ok(layout.bottom <= viewport.height - 11, 'never escapes the bottom edge');
          assert.equal(layout.overflowX, false, 'no horizontal overflow inside the popup');
          assert.equal(layout.hitTest, true, 'the popup is painted above the header, not clipped by it');
          assert.equal(layout.focusedInside, true, 'opening moves focus into the popup');
          assert.equal(layout.labelWrap, 'normal');
          assert.equal(layout.closeHit, '-6px', 'the 32px close visual keeps a 44px touch target');
          assert.ok((await close.boundingBox()).width >= 32);
          if (kind === 'jobs') {
            assert.equal(layout.scrollable, true, 'a long roster scrolls inside the popup');
            assert.equal(await panel.locator('.dsh-mobile-badge-row:is(button)').count(), 0, 'status-only jobs are not inert buttons');
            assert.equal(await panel.locator('.dsh-mobile-badge-row-meta').first().innerText(), '运行中');
            assert.match(await panel.locator('.dsh-mobile-badge-row-detail').first().innerText(), /12 \/ 24/);
            await panel.locator('ul').evaluate(list => { list.scrollTop = list.scrollHeight; });
            assert.ok(await panel.locator('ul').evaluate(list => list.scrollTop > 0));
            await panel.locator('ul').evaluate(list => { list.scrollTop = 0; });
          } else {
            assert.equal(await panel.locator('.dsh-mobile-badge-row:is(button)').count(), 3, 'every subagent row stays navigable');
            assert.equal(await panel.locator('.dsh-mobile-badge-row-arrow').count(), 3);
            assert.deepEqual(await panel.locator('.dsh-mobile-badge-row-meta').allInnerTexts(), ['运行中', '已完成', '未运行']);
            assert.equal(await panel.locator('.dsh-mobile-badge-panel-summary').innerText(), '共 3 项 · 1 项运行中');
          }
          await shot(kind, dark, viewport);
          await close.tap();
          await panel.waitFor({ state: 'detached' });
          assert.equal(await trigger(kind).evaluate(button => button === document.activeElement), true, 'closing restores the trigger focus');
          assert.equal(await trigger(kind).getAttribute('aria-expanded'), 'false');
        }
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));

    // A resumed child must show running even while an older completion is still
    // projected, then update back to completed without closing the popup.
    await openPanel('subagents');
    await page.evaluate(() => window.setSubagentState('review', {
      running: true, projectionValues: { subagentTiming: { settledMs: 1234, lastTurnCompleted: true } },
    }));
    await page.waitForFunction(() => document.querySelectorAll('.dsh-mobile-badge-row-meta')[1]?.textContent === '运行中');
    assert.equal(await panel.locator('.dsh-mobile-badge-panel-summary').innerText(), '共 3 项 · 2 项运行中');
    await page.evaluate(() => window.setSubagentState('review', {
      running: false, projectionValues: { subagentTiming: { settledMs: 2345, lastTurnCompleted: true } },
    }));
    await page.waitForFunction(() => document.querySelectorAll('.dsh-mobile-badge-row-meta')[1]?.textContent === '已完成');
    assert.equal(await panel.locator('.dsh-mobile-badge-panel-summary').innerText(), '共 3 项 · 1 项运行中');
    await close.tap();
    await panel.waitFor({ state: 'detached' });

    // Same icon toggles: open -> close -> open, for BOTH icons, not just the X.
    for (const kind of ['subagents', 'jobs']) {
      await openPanel(kind);
      await trigger(kind).tap();
      await panel.waitFor({ state: 'detached' });
      assert.equal(await trigger(kind).getAttribute('aria-expanded'), 'false');
      await openPanel(kind);
      assert.equal(await trigger(kind).getAttribute('aria-expanded'), 'true');
      assert.equal(await panel.getAttribute('data-placement'), 'below');
    }
    // Switching icons re-anchors the open popup instead of stacking a second one.
    // The loop above leaves the jobs popup open, so this tap is a real switch.
    await trigger('subagents').tap();
    await panel.waitFor({ state: 'visible' });
    assert.equal(await panel.count(), 1);
    assert.equal(await trigger('subagents').getAttribute('aria-expanded'), 'true');
    assert.equal(await trigger('jobs').getAttribute('aria-expanded'), 'false');
    const subagentsAnchor = await trigger('subagents').boundingBox();
    assert.ok(Math.abs((await panel.boundingBox()).y - (subagentsAnchor.y + subagentsAnchor.height + 8)) <= 1.5, 'switching icons re-anchors the popup');
    await trigger('jobs').tap();
    await panel.waitFor({ state: 'visible' });
    assert.equal(await panel.count(), 1);
    assert.equal(await trigger('jobs').getAttribute('aria-expanded'), 'true');
    const jobsAnchor = await trigger('jobs').boundingBox();
    assert.ok(Math.abs((await panel.boundingBox()).y - (jobsAnchor.y + jobsAnchor.height + 8)) <= 1.5, 'switching icons re-anchors the popup');

    // Esc, focus leaving, and an outside tap all close it.
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    // Tab reaches the popup's scrollable list (keyboard scrolling works), and
    // moving focus to a control outside the popup dismisses it.
    await openPanel('jobs');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('dsh-mobile-badge-panel-list')), true, 'Tab stays inside the popup');
    await page.evaluate(() => document.querySelector('[data-composer-dock] button').focus());
    await panel.waitFor({ state: 'detached' });
    await openPanel('jobs');
    await page.touchscreen.tap(8, 8);
    await panel.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.openPopovers()), 0, 'nothing is left in the top layer');

    // The page behind stays usable: an outside tap lands on the composer control.
    await openPanel('jobs');
    const control = page.locator('[data-composer-dock] button').first();
    await control.tap();
    await panel.waitFor({ state: 'detached' });
    assert.equal(await control.getAttribute('aria-expanded'), 'true', 'the popup never blocked the page underneath');
    await control.tap();
    assert.equal(await control.getAttribute('aria-expanded'), 'false');

    // Navigating to a subagent opens its session and closes the popup.
    await openPanel('subagents');
    await panel.getByRole('button', { name: /检查移动端弹层布局/ }).tap();
    assert.deepEqual(await page.evaluate(() => window.openedSessions), ['child']);
    await panel.waitFor({ state: 'detached' });

    // Session switch and plugin teardown close the popup and leave no top-layer node.
    await openPanel('jobs');
    await page.evaluate(() => window.changeSession('another-session'));
    await panel.waitFor({ state: 'detached' });
    await page.locator('.dsh-mobile-badge').waitFor({ state: 'detached' });
    await page.evaluate(() => window.changeSession('parent'));
    await page.locator('.dsh-mobile-badge-jobs').waitFor({ state: 'visible' });
    await openPanel('jobs');
    await page.evaluate(() => window.disableMobile());
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-dsh-mobile'));
    await panel.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.openPopovers()), 0, 'deactivation cannot leave a top-layer popup blocking the host');
    assert.equal(await page.locator('dialog:modal').count(), 0);
    await page.evaluate(() => window.disposeMobile());
    assert.equal(await page.evaluate(() => window.openPopovers()), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

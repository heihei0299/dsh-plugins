import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'));
const zh = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8'));
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');

function loadBundle() {
  let registration;
  const window = {
    __ModuleLoader__: {
      load: (value) => { registration = value; }
    }
  };
  const sandbox = { window, console, URL };
  vm.runInNewContext(bundle, sandbox, { filename: 'dist/client.js' });
  assert.ok(registration, 'bundle must register one module');
  return registration;
}

const ReactStub = {
  createElement: (...args) => ({ args }),
  useCallback: (fn) => fn,
  useSyncExternalStore: () => {},
  useRef: () => ({}),
  useState: () => [],
  useEffect: () => {}
};

test('package exposes the dsh-go host, client, locale, icon, and bundle patch', () => {
  assert.equal(packageJson.name, '@local/dsh-mcp-skill-manager');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.engines.dsh, '0.2.2-rc.1');
  assert.equal(packageJson.main, './lib/index.js');
  assert.equal(packageJson.exports['.'], './lib/index.js');
  assert.equal(packageJson.exports['./client'], './dist/client.js');
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(packageJson.dsh.client.platform, 'web');
  assert.equal(packageJson.dsh.client.immediately, true);
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'));
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.ok(packageJson.files.includes('lib/'));
  assert.ok(packageJson.files.includes('dist/client.js'));
  assert.ok(packageJson.files.includes('cordis.patch.yml'));
  assert.equal(packageJson.dshGo.v, 1);
  assert.equal(packageJson.dshGo.icon, 'plugin');
  assert.equal(packageJson.dshGo.contributes.panels[0].id, 'policy');
});

test('bundle patch inserts exactly the host plugin', () => {
  assert.match(patch, /id:\s*mcp-skill-manager/);
  assert.match(patch, /name:\s*'@local\/dsh-mcp-skill-manager'/);
  assert.equal((patch.match(/^\s*-\s*insert:/gm) ?? []).length, 1);
});

test('locale dictionaries have the same keys and metadata', () => {
  assert.deepEqual(Object.keys(en.meta).sort(), Object.keys(zh.meta).sort());
  assert.deepEqual(Object.keys(en.ui).sort(), Object.keys(zh.ui).sort());
  assert.ok(en.meta.title.length > 0);
  assert.ok(en.meta.description.length > 0);
  assert.ok(zh.meta.title.length > 0);
  assert.ok(zh.meta.description.length > 0);
});

test('icon is a non-empty svg', async () => {
  const icon = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8');
  assert.match(icon, /^<svg[\s>]/);
  assert.ok((await stat(new URL('../assets/icon.svg', import.meta.url))).size > 0);
});

test('bundle registers one factory, requires only react, and wires the settings section', () => {
  assert.equal((bundle.match(/__ModuleLoader__\.load\(/g) ?? []).length, 1);
  assert.equal(bundle.includes('dangerouslySetInnerHTML'), false);
  assert.equal(bundle.includes('innerHTML ='), false);
  assert.equal(/fetch\(\s*["']\/api\//.test(bundle), false);

  const registration = loadBundle();
  assert.equal(registration.id, packageJson.name);
  const required = [];
  const exports2 = registration.factory((id) => {
    required.push(id);
    if (id === 'react') return ReactStub;
    throw new Error(`unexpected require ${id}`);
  });
  assert.ok(required.length >= 1);
  assert.deepEqual([...new Set(required)], ['react']);
  assert.deepEqual([...exports2.inject], ['slots', 'locale']);
  assert.equal(typeof exports2.apply, 'function');

  const dictionaries = [];
  let section;
  const disposers = [];
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    locale: {
      register: (namespace, language, dictionary) => {
        dictionaries.push({ namespace, language, dictionary });
        return () => {};
      },
      bind: () => (key) => key
    },
    slots: {
      inject: (slot, callback) => callback(),
      register: (options, component) => {
        section = { options, component };
        return () => {};
      }
    }
  };
  exports2.apply(ctx);
  assert.deepEqual(dictionaries.map((entry) => entry.language), ['en', 'zh']);
  assert.ok(dictionaries.every((entry) => entry.namespace === 'mcpSkillManager'));
  assert.equal(section.options.name, 'settings.section');
  assert.equal(section.options.id, 'mcp-skill-manager');
  assert.equal(section.options.order, 60);
  assert.equal(section.options.label(), 'nav');
  assert.equal(typeof section.component, 'function');
  for (const dispose of disposers) dispose();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStyles, SMARTUI_STYLE_ATTRIBUTE, SMARTUI_STYLE_ID } from '../src/client/install-styles.js';

interface FakeStyle {
  isConnected: boolean;
  attributes: Map<string, string>;
  textContent: string;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

function fakeDocument() {
  const tags: FakeStyle[] = [];
  const document = {
    head: { append(style: FakeStyle) { tags.push(style); style.isConnected = true; } },
    createElement(tag: string): FakeStyle {
      assert.equal(tag, 'style');
      const style: FakeStyle = {
        isConnected: false,
        attributes: new Map(),
        textContent: '',
        setAttribute(name, value) { style.attributes.set(name, value); },
        remove() {
          style.isConnected = false;
          const index = tags.indexOf(style);
          if (index >= 0) tags.splice(index, 1);
        },
      };
      return style;
    },
    querySelector(selector: string): FakeStyle | null {
      assert.equal(selector, `style[${SMARTUI_STYLE_ATTRIBUTE}="${SMARTUI_STYLE_ID}"]`);
      return tags.find(style => style.isConnected) ?? null;
    },
  };
  return { document: document as unknown as Document, tags };
}

test('one stylesheet is shared by every installation and removed with the last lease', () => {
  const { document, tags } = fakeDocument();
  const first = installStyles('.smartui-root { color: red }', document);
  const second = installStyles('.smartui-root { color: red }', document);
  assert.equal(tags.length, 1);
  assert.equal(tags[0]?.attributes.get(SMARTUI_STYLE_ATTRIBUTE), SMARTUI_STYLE_ID);
  assert.equal(tags[0]?.textContent, '.smartui-root { color: red }');
  first();
  assert.equal(tags.length, 1, 'the remaining lease keeps the stylesheet');
  first();
  assert.equal(tags.length, 1, 'disposal is idempotent');
  second();
  assert.equal(tags.length, 0);
  second();
  assert.equal(tags.length, 0);
});

test('a later installation creates a fresh stylesheet after full disposal', () => {
  const { document, tags } = fakeDocument();
  installStyles('.smartui-root { color: red }', document)();
  assert.equal(tags.length, 0);
  installStyles('.smartui-root { color: blue }', document);
  assert.equal(tags.length, 1);
  assert.equal(tags[0]?.textContent, '.smartui-root { color: blue }');
});

test('an existing plugin stylesheet is adopted and refreshed instead of duplicated', () => {
  const { document, tags } = fakeDocument();
  const existing = document.createElement('style');
  existing.setAttribute(SMARTUI_STYLE_ATTRIBUTE, SMARTUI_STYLE_ID);
  existing.textContent = 'old';
  document.head.append(existing);
  assert.equal(tags.length, 1);
  const dispose = installStyles('.smartui-root { color: green }', document);
  assert.equal(tags.length, 1);
  assert.equal(existing.textContent, '.smartui-root { color: green }');
  dispose();
  assert.equal(tags.length, 0);
});

test('installing outside a browser is a no-op', () => {
  const dispose = installStyles('.smartui-root {}', undefined);
  assert.doesNotThrow(dispose);
  assert.doesNotThrow(dispose);
});

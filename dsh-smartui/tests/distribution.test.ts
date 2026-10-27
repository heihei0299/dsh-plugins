import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as { files?: string[] };

/** Minimal `files` matcher: `dist/` is a directory, `*` stays within a segment, `**` spans segments. */
function packaged(file: string): boolean {
  return (manifest.files ?? []).some(pattern => {
    const body = pattern.replace(/^\.\//, '');
    const source = (body.endsWith('/') ? `${body}**` : body)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
    return new RegExp(`^${source}$`).test(file);
  });
}

async function walk(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) files.push(...await walk(child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

test('README relative links resolve and every shipped link target is packaged', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const targets = [...readme.matchAll(/\]\(<([^>]+)>\)|\]\(([^)\s]+)\)/g)]
    .map(match => match[1] ?? match[2])
    .filter((target): target is string =>
      target !== undefined && target !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#'));
  assert.ok(targets.length > 0, 'README should keep at least one local link');
  for (const target of targets) {
    assert.ok((await stat(new URL(target, root))).isFile(), `README link target is missing: ${target}`);
    assert.ok(packaged(target), `README links a file the package does not distribute: ${target}`);
  }
});

test('every tracked example is both linked from the README and included in package files', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  for (const entry of await readdir(new URL('examples/', root))) {
    if (!entry.endsWith('.json')) continue;
    assert.ok(readme.includes(`examples/${entry}`), `README should link examples/${entry}`);
    assert.ok(packaged(`examples/${entry}`), `package files must include examples/${entry}`);
  }
});

test('source comments do not point at untracked, undistributed local notes', async () => {
  for (const file of await walk(new URL('src/', root))) {
    if (!/\.(?:ts|tsx|css)$/.test(file.pathname)) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /docs\/|HANDOFF\.md/, `${file.pathname} references a note that is not tracked or distributed`);
  }
});

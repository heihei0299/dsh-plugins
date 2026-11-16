import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The upstream suite asserts that an access mode survives an atomic rewrite
// (0600 vs 0640). A restrictive umask would make the fixture itself 0600 and
// fail the check for a reason unrelated to the optimizer, so the runner pins
// the umask its CI uses.
process.umask(0o022)

const root = fileURLToPath(new URL('..', import.meta.url))
const upstream = join(root, 'test', 'upstream')
const files = [
  join(root, 'test', 'host.test.ts'),
  join(root, 'test', 'audit.test.ts'),
  ...readdirSync(upstream)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join(upstream, name)),
]
// The optimizer writes its environment switches into the host process, so a
// Harness that already mounted this plugin (or a shell sourced from one) exports
// PI_CACHE_* / DSH_CACHE_* to children. Those switches are per-process state the
// suite sets up itself, so the runner strips them instead of letting one host's
// retention or footer choice change the fixtures.
const env = {}
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('PI_CACHE') || key.startsWith('DSH_CACHE')) continue
  env[key] = value
}
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
  cwd: root,
  stdio: 'inherit',
  env,
})
process.exit(result.status ?? 1)

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
  ...readdirSync(upstream)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => join(upstream, name)),
]
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)

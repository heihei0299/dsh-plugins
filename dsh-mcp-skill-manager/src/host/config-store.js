/**
 * Policy file persistence: synchronous load, validated normalization, and
 * serialized atomic writes.
 *
 * @module @local/dsh-mcp-skill-manager/host/config-store
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { POLICY_VERSION } from '../shared/contract.js';
import { defaultPolicy, normalizePath, normalizePolicy } from './policy.js';

/** File name used under the DeepSeek Harness home. */
export const STATE_FILE_NAME = 'mcp-skill-manager.json';

/** Resolve the DeepSeek Harness home with the documented precedence. */
export function resolveDshHome(env = process.env) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  return configured.length > 0 ? configured : path.join(homedir(), '.dsh');
}

/**
 * Resolve the policy file path.
 * @param {unknown} configured - optional absolute override from plugin config.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {{ file: string, warning?: string }} resolved file.
 */
export function resolveStateFile(configured, env = process.env) {
  const fallback = path.join(resolveDshHome(env), STATE_FILE_NAME);
  if (typeof configured !== 'string' || configured.trim().length === 0) return { file: fallback };
  if (!path.isAbsolute(configured)) {
    return { file: fallback, warning: 'stateFile must be an absolute path; using the default policy file' };
  }
  return { file: path.normalize(configured) };
}

/** Display a path relative to the resolved Harness home. */
export function displayPath(file, env = process.env) {
  const home = resolveDshHome(env);
  const relation = path.relative(home, file);
  if (relation.length === 0) return env?.DSH_HOME?.trim() ? '$DSH_HOME' : '~/.dsh';
  if (relation.startsWith('..') || path.isAbsolute(relation)) return file;
  const symbol = env?.DSH_HOME?.trim() ? '$DSH_HOME' : '~/.dsh';
  return `${symbol}/${relation.split(path.sep).join('/')}`;
}

/** Canonicalize one existing project directory, or keep its resolved path. */
export function canonicalizeProjectPath(value, platform = process.platform) {
  const normalized = normalizePath(value, platform);
  try {
    const real = realpathSync(normalized);
    const info = statSync(real);
    return { path: normalizePath(real, platform), exists: true, directory: info.isDirectory() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: normalized, exists: false, directory: false };
    throw error;
  }
}

/**
 * Create the policy store.
 * @param {{ file?: string, platform?: string, env?: Record<string, string | undefined>, logger?: { warn: (message: string) => void } }} [options]
 */
export function createConfigStore(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const resolved = resolveStateFile(options.file, env);
  const file = resolved.file;
  const logger = options.logger;
  let policy = defaultPolicy();
  let configError = null;
  let warnings = [];
  let writeTail = Promise.resolve();

  /** @returns {{ policy: object, error: { code: string, message: string } | null, warnings: Array<object> }} */
  function readSync() {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        policy = defaultPolicy();
        configError = null;
        warnings = [];
        return { policy, error: null, warnings };
      }
      configError = { code: 'read-failed', message: error instanceof Error ? error.message : String(error) };
      policy = defaultPolicy();
      warnings = [];
      return { policy, error: configError, warnings };
    }
    try {
      const parsed = JSON.parse(text);
      const result = normalizePolicy(parsed, { platform, canonicalize: (value) => canonicalizeProjectPath(value, platform) });
      policy = result.policy;
      warnings = result.warnings;
      configError = null;
    } catch (error) {
      policy = defaultPolicy();
      warnings = [];
      configError = {
        code: error?.code ?? 'invalid-policy',
        message: error instanceof Error ? error.message : String(error)
      };
    }
    return { policy, error: configError, warnings };
  }

  /** Serialize one policy document to its on-disk wire form. */
  function serialize(nextPolicy) {
    return `${JSON.stringify({ version: POLICY_VERSION, projects: nextPolicy.projects }, null, 2)}\n`;
  }

  /**
   * Persist one already-normalized policy. The in-memory policy changes only
   * after the atomic rename succeeds.
   * @param {object} nextPolicy - normalized policy.
   */
  async function write(nextPolicy) {
    const text = serialize(nextPolicy);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const run = async () => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      try {
        await writeFile(temp, text, { mode: 0o600 });
        await rename(temp, file);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    };
    const task = writeTail.then(run, run);
    writeTail = task.catch(() => {});
    await task;
    policy = nextPolicy;
    configError = null;
    warnings = [];
    return policy;
  }

  return {
    file,
    platform,
    displayFile: displayPath(file, env),
    readSync,
    write,
    getPolicy: () => policy,
    getError: () => configError,
    getWarnings: () => warnings,
    resolveWarning: resolved.warning,
    logger
  };
}

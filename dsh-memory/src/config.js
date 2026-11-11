/**
 * Configuration and path resolution for the dsh-memory plugin.
 *
 * The defaults mirror Codex's `[memories]` settings for the v2 pipeline
 * (codex-rs/config/src/types.rs): idle/age windows, per-startup claim limits,
 * consolidation input size, retention, and the consolidation cooldown. DSH has
 * no rate-limit headroom surface, so `minRateLimitRemainingPercent` is accepted
 * for config parity but does not gate a run.
 */

import os from "node:os";
import path from "node:path";

/** Codex's v2 memory database filename. */
export const DB_FILENAME = "memories_v2_1.sqlite";
/** Codex's default OK, retention/selection windows. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  version: "v2",
  generateMemories: true,
  useMemories: true,
  dedicatedTools: false,
  disableOnExternalContext: false,
  maxRawMemoriesForConsolidation: 256,
  maxUnusedDays: 30,
  maxRolloutAgeDays: 10,
  maxRolloutsPerStartup: 2,
  minRolloutIdleHours: 6,
  minRateLimitRemainingPercent: 25,
  extractModel: undefined,
  consolidationModel: undefined,
  extractReasoningEffort: "low",
  consolidationReasoningEffort: "medium",
  concurrency: 8,
  jobLeaseSeconds: 3_600,
  retryDelaySeconds: 3_600,
  phase2CooldownSeconds: 6 * 60 * 60,
  extensionRetentionDays: 14,
  maxRolloutEvents: 4_000,
  maxRowBytes: 10_000,
  maxInputBytes: 400_000,
  maxConsolidationBytes: 240_000,
  summaryMaxBytes: 10_000,
  log: false,
});

/** Directory name for the latest memory pipeline, matching Codex. */
export function memoryDirectoryName() {
  return "memories_v2";
}

/**
 * Resolve the DSH home with the documented precedence (configured, $DSH_HOME,
 * ~/.dsh). The plugin keeps this local so a host-only install needs no runtime
 * dependency beyond Node itself.
 *
 * @param configured - explicit plugin override.
 * @param env - environment mapping; defaults to the process environment.
 * @returns an absolute home path.
 */
export function resolveHome(configured, env = process.env) {
  if (typeof configured === "string" && configured.trim() !== "") return path.resolve(configured);
  const fromEnv = env.DSH_HOME?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".dsh");
}

/** Read a positive safe integer, or the fallback. */
function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Read a non-negative safe integer, or the fallback. */
function nonNegativeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/** Clamp one numeric config value to Codex's documented range. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Read a boolean, or the fallback. */
function boolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/** Read a trimmed string, or undefined when empty. */
function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Normalize one plugin config object. Unknown keys are ignored; invalid scalar
 * values fall back to the documented default instead of failing the mount.
 *
 * @param raw - loader config from the bundle patch.
 * @param env - environment mapping for home resolution.
 * @returns a frozen effective configuration.
 */
export function readConfig(raw, env = process.env) {
  const input = raw && typeof raw === "object" ? raw : {};
  const home = resolveHome(input.home, env);
  const version = input.version === undefined ? DEFAULTS.version : String(input.version);
  if (version !== "v2") {
    throw new Error(`dsh-memory: unsupported memory version "${version}" (this plugin implements the latest v2 engine)`);
  }
  const root = typeof input.memoryRoot === "string" && input.memoryRoot.trim() !== ""
    ? path.resolve(input.memoryRoot)
    : path.join(home, memoryDirectoryName());
  return Object.freeze({
    enabled: boolean(input.enabled, DEFAULTS.enabled),
    version,
    generateMemories: boolean(input.generateMemories, DEFAULTS.generateMemories),
    useMemories: boolean(input.useMemories, DEFAULTS.useMemories),
    dedicatedTools: boolean(input.dedicatedTools, DEFAULTS.dedicatedTools),
    disableOnExternalContext: boolean(input.disableOnExternalContext, DEFAULTS.disableOnExternalContext),
    maxRawMemoriesForConsolidation: clamp(positiveInteger(input.maxRawMemoriesForConsolidation, DEFAULTS.maxRawMemoriesForConsolidation), 1, 4096),
    maxUnusedDays: clamp(nonNegativeInteger(input.maxUnusedDays, DEFAULTS.maxUnusedDays), 0, 365),
    maxRolloutAgeDays: clamp(nonNegativeInteger(input.maxRolloutAgeDays, DEFAULTS.maxRolloutAgeDays), 0, 90),
    maxRolloutsPerStartup: clamp(positiveInteger(input.maxRolloutsPerStartup, DEFAULTS.maxRolloutsPerStartup), 1, 128),
    minRolloutIdleHours: clamp(nonNegativeInteger(input.minRolloutIdleHours, DEFAULTS.minRolloutIdleHours), 1, 48),
    minRateLimitRemainingPercent: clamp(nonNegativeInteger(input.minRateLimitRemainingPercent, DEFAULTS.minRateLimitRemainingPercent), 0, 100),
    extractModel: text(input.extractModel),
    consolidationModel: text(input.consolidationModel),
    extractReasoningEffort: text(input.extractReasoningEffort) ?? DEFAULTS.extractReasoningEffort,
    consolidationReasoningEffort: text(input.consolidationReasoningEffort) ?? DEFAULTS.consolidationReasoningEffort,
    concurrency: positiveInteger(input.concurrency, DEFAULTS.concurrency),
    jobLeaseSeconds: positiveInteger(input.jobLeaseSeconds, DEFAULTS.jobLeaseSeconds),
    retryDelaySeconds: positiveInteger(input.retryDelaySeconds, DEFAULTS.retryDelaySeconds),
    phase2CooldownSeconds: nonNegativeInteger(input.phase2CooldownSeconds, DEFAULTS.phase2CooldownSeconds),
    extensionRetentionDays: nonNegativeInteger(input.extensionRetentionDays, DEFAULTS.extensionRetentionDays),
    maxRolloutEvents: positiveInteger(input.maxRolloutEvents, DEFAULTS.maxRolloutEvents),
    maxRowBytes: positiveInteger(input.maxRowBytes, DEFAULTS.maxRowBytes),
    maxInputBytes: positiveInteger(input.maxInputBytes, DEFAULTS.maxInputBytes),
    maxConsolidationBytes: positiveInteger(input.maxConsolidationBytes, DEFAULTS.maxConsolidationBytes),
    summaryMaxBytes: positiveInteger(input.summaryMaxBytes, DEFAULTS.summaryMaxBytes),
    log: boolean(input.log, DEFAULTS.log),
    home,
    root,
    dbPath: path.join(root, DB_FILENAME),
  });
}

/** Paths owned by one memory root. */
export function memoryPaths(root) {
  return {
    root,
    database: path.join(root, DB_FILENAME),
    baseline: path.join(root, ".dsh-memory-baseline.json"),
    summary: path.join(root, "memory_summary.md"),
    memory: path.join(root, "MEMORY.md"),
    rawMemories: path.join(root, "raw_memories.md"),
    rolloutSummaries: path.join(root, "rollout_summaries"),
    extensions: path.join(root, "extensions"),
    adHocNotes: path.join(root, "extensions", "ad_hoc", "notes"),
    workspaceDiff: path.join(root, "phase2_workspace_diff.md"),
  };
}

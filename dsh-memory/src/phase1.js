/**
 * Phase 1: per-session rollout extraction.
 *
 * Mirrors Codex's v2 stage one: select idle root sessions from the durable
 * session catalog, render bounded evidence, ask the extract model for a
 * JSON `{ rollout_summary, rollout_slug }`, then upsert the untruncated
 * summary (redacted and capped at 9,000 bytes). Failures keep a retry
 * watermark; successful no-ops advance the job without inventing output.
 */

import { statSync } from "node:fs";
import { completeText, parseStageOneOutput } from "./llm.js";
import { redactSecrets } from "./redact.js";
import { renderTranscript, truncateText } from "./transcript.js";
import { summaryFileName } from "./workspace.js";
import { STAGE_ONE_SYSTEM, stageOneInput } from "./prompts.js";

const SUMMARY_BYTES = 9_000;
const SCAN_LIMIT = 5_000;

/** Whether a session header describes a root session. */
export function isRootHeader(header) {
  if (header === undefined || header === null) return false;
  if (header.origin === "subagent") return false;
  if (Number(header.delegationDepth ?? 0) > 0) return false;
  return true;
}

/** File mtime in milliseconds, or a fallback. */
function mtimeOf(location) {
  if (typeof location?.path !== "string") return undefined;
  try {
    return statSync(location.path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Read the last `maxEvents` committed events through a read handle. */
export async function readSessionEvents(persistence, sessionId, maxEvents, signal) {
  const stat = await persistence.stat(sessionId, signal === undefined ? undefined : { signal });
  const handle = await persistence.open(sessionId, "read", signal === undefined ? undefined : { signal });
  try {
    const count = Number.isSafeInteger(stat?.eventCount) && stat.eventCount > 0 ? stat.eventCount : undefined;
    if (count !== undefined) {
      const offset = Math.max(0, count - maxEvents);
      const result = await handle.read(offset, count - offset, signal === undefined ? undefined : { signal });
      return result.events;
    }
    const result = await handle.read(0, undefined, signal === undefined ? undefined : { signal });
    return result.events.slice(-maxEvents);
  } finally {
    await handle.close();
  }
}

/** Whether evidence contains an external-context source. */
export function hasExternalContext(events) {
  for (const event of events) {
    if (event?.type === "tool/call") {
      const name = String(event.data?.name ?? "");
      if (name === "web_search" || name === "web_fetch" || name.startsWith("mcp__") || name.startsWith("mcp_")) return true;
    }
    if (event?.type === "user/message" && event.data?.source?.kind === "mcp") return true;
  }
  return false;
}

/**
 * List idle, in-window root sessions.
 *
 * @returns candidates sorted by newest activity first.
 */
export async function listCandidates(persistence, config, currentSessionId, now = Date.now(), signal) {
  const snapshots = await persistence.list(signal === undefined ? undefined : { signal });
  const maxAgeMs = config.maxRolloutAgeDays * 86_400_000;
  const idleMs = config.minRolloutIdleHours * 3_600_000;
  const candidates = [];
  for (const snapshot of snapshots) {
    const header = snapshot?.header;
    if (!isRootHeader(header)) continue;
    if (currentSessionId !== undefined && header.id === currentSessionId) continue;
    const updatedAt = mtimeOf(snapshot.location) ?? Number(header.createdAt ?? 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
    const age = now - updatedAt;
    if (age > maxAgeMs) continue;
    if (age < idleMs) continue;
    candidates.push({ sessionId: header.id, header, updatedAt, location: snapshot.location });
  }
  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates.slice(0, SCAN_LIMIT);
}

/** Map with a fixed concurrency cap. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Run the extraction jobs for one startup. One failure never aborts the batch.
 *
 * @returns counters for logs/tests.
 */
export async function runPhase1(options) {
  const {
    store, persistence, llm, config, route, currentSessionId, signal, logger,
  } = options;
  const stats = { candidates: 0, claimed: 0, succeeded: 0, noOutput: 0, skipped: 0, failed: 0 };
  if (!config.generateMemories) return stats;
  if (route?.provider === undefined || route?.model === undefined) {
    logger?.warn?.("dsh-memory: phase 1 skipped; the triggering agent has no model route");
    return stats;
  }
  const candidates = await listCandidates(persistence, config, currentSessionId, Date.now(), signal);
  stats.candidates = candidates.length;
  const claims = [];
  for (const candidate of candidates) {
    if (claims.length >= config.maxRolloutsPerStartup) break;
    if (signal?.aborted) break;
    const sourceUpdatedAt = Math.floor(candidate.updatedAt / 1000);
    if (!store.needsUpdate(candidate.sessionId, sourceUpdatedAt)) continue;
    const claim = store.claimStage1(candidate.sessionId, currentSessionId ?? "dsh-memory", sourceUpdatedAt, {
      leaseSeconds: config.jobLeaseSeconds,
      maxRunning: config.maxRolloutsPerStartup,
    });
    if (claim.claimed) claims.push({ candidate, claim });
    else if (claim.reason !== "up-to-date") logger?.debug?.(`dsh-memory: stage-1 claim skipped for ${candidate.sessionId}: ${claim.reason}`);
  }
  stats.claimed = claims.length;

  await mapLimit(claims, config.concurrency, async ({ candidate, claim }) => {
    if (signal?.aborted) return;
    try {
      const events = await readSessionEvents(persistence, candidate.sessionId, config.maxRolloutEvents, signal);
      if (config.disableOnExternalContext && hasExternalContext(events)) {
        store.markStage1Skipped(candidate.sessionId, claim.token);
        stats.skipped += 1;
        return;
      }
      const evidence = renderTranscript(events, {
        maxInputBytes: config.maxInputBytes,
        maxRowBytes: config.maxRowBytes,
      });
      if (evidence.trim() === "") {
        store.markStage1NoOutput(candidate.sessionId, claim.token);
        stats.noOutput += 1;
        return;
      }
      const cwd = candidate.header.cwd ?? "unknown";
      const prompt = stageOneInput({
        rollout_path: candidate.location?.path ?? candidate.sessionId,
        rollout_cwd: cwd,
        rollout_git_branch: "unknown",
        rollout_contents: evidence,
      });
      const output = await completeText(llm, {
        provider: route.provider,
        model: config.extractModel ?? route.model,
        system: STAGE_ONE_SYSTEM,
        prompt,
        reasoningEffort: config.extractReasoningEffort,
        signal,
        purpose: "memory_extract",
      });
      const parsed = parseStageOneOutput(output);
      const summary = truncateText(redactSecrets(parsed.summary).trim(), SUMMARY_BYTES);
      if (summary.trim() === "") {
        store.markStage1NoOutput(candidate.sessionId, claim.token);
        stats.noOutput += 1;
        return;
      }
      const slug = truncateText(redactSecrets(parsed.slug).trim(), 80);
      const fileName = summaryFileName({
        threadId: candidate.sessionId,
        sourceUpdatedAt: Math.floor(candidate.updatedAt / 1000),
        rolloutSlug: slug,
      });
      store.markStage1Succeeded(
        candidate.sessionId,
        claim.token,
        Math.floor(candidate.updatedAt / 1000),
        summary,
        slug,
        fileName,
        { cwd, rolloutPath: candidate.location?.path },
      );
      stats.succeeded += 1;
    } catch (error) {
      if (signal?.aborted) return;
      store.markStage1Failed(candidate.sessionId, claim.token, error instanceof Error ? error.message : String(error), config.retryDelaySeconds);
      stats.failed += 1;
      logger?.warn?.(`dsh-memory: phase 1 failed for ${candidate.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return stats;
}

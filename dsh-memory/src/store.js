/**
 * SQLite state for the v2 memory pipeline.
 *
 * The tables and claim semantics mirror Codex's memory store
 * (`codex-rs/state/src/runtime/memories.rs`): per-thread stage-1 outputs, lease
 * based extraction jobs with retry backoff, and one global phase-2 job with a
 * success cooldown. The extra `summary_file` column lets the read-path tools
 * attribute usage back to a thread without parsing filenames.
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const STAGE1 = "memory_stage1";
export const PHASE2 = "memory_consolidate_global";
export const PHASE2_KEY = "global";
const RETRY_REMAINING = 3;

/** Unix seconds for a millisecond timestamp. */
export function toSeconds(ms) {
  return Math.floor(Number(ms) / 1000);
}

/** Current unix seconds. */
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** One stage-1 output plus the thread metadata the pipeline needs. */
export function outputFromRow(row) {
  return {
    threadId: row.thread_id,
    sourceUpdatedAt: Number(row.source_updated_at),
    rawMemory: row.raw_memory ?? "",
    rolloutSummary: row.rollout_summary ?? "",
    rolloutSlug: row.rollout_slug ?? undefined,
    generatedAt: Number(row.generated_at),
    usageCount: row.usage_count === null || row.usage_count === undefined ? 0 : Number(row.usage_count),
    lastUsage: row.last_usage === null || row.last_usage === undefined ? undefined : Number(row.last_usage),
    selectedForPhase2: Number(row.selected_for_phase2) !== 0,
    summaryFile: row.summary_file ?? undefined,
    cwd: row.cwd ?? undefined,
    rolloutPath: row.rollout_path ?? undefined,
    gitBranch: row.git_branch ?? undefined,
  };
}

/** Durable memory state. All methods are synchronous and process-local. */
export class MemoryStore {
  /**
   * @param dbPath - absolute SQLite path.
   */
  constructor(dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  /** Create the v2 schema and indexes when absent. */
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stage1_outputs (
        thread_id TEXT PRIMARY KEY,
        source_updated_at INTEGER NOT NULL,
        raw_memory TEXT NOT NULL,
        rollout_summary TEXT NOT NULL,
        rollout_slug TEXT,
        generated_at INTEGER NOT NULL,
        usage_count INTEGER,
        last_usage INTEGER,
        selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
        selected_for_phase2_source_updated_at INTEGER,
        summary_file TEXT,
        cwd TEXT,
        rollout_path TEXT,
        git_branch TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_stage1_outputs_source_updated_at
        ON stage1_outputs(source_updated_at DESC, thread_id DESC);
      CREATE TABLE IF NOT EXISTS jobs (
        kind TEXT NOT NULL,
        job_key TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_id TEXT,
        ownership_token TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        lease_until INTEGER,
        retry_at INTEGER,
        retry_remaining INTEGER NOT NULL,
        last_error TEXT,
        input_watermark INTEGER,
        last_success_watermark INTEGER,
        PRIMARY KEY (kind, job_key)
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_kind_status_retry_lease
        ON jobs(kind, status, retry_at, lease_until);
      CREATE TABLE IF NOT EXISTS consolidation_progress (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        max_thread_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO consolidation_progress (singleton, max_thread_count) VALUES (1, 0);
      PRAGMA user_version = 1;
    `);
    // Codex's own memories_v2 DB lacks these DSH-specific provenance columns.
    // Adding them keeps an existing Codex workspace readable instead of failing
    // on a SELECT that names them.
    for (const [column, definition] of [
      ["summary_file", "TEXT"],
      ["cwd", "TEXT"],
      ["rollout_path", "TEXT"],
      ["git_branch", "TEXT"],
    ]) {
      const columns = this.db.prepare("PRAGMA table_info(stage1_outputs)").all().map((row) => row.name);
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE stage1_outputs ADD COLUMN ${column} ${definition}`);
    }
  }

  /** Run one immediate transaction; rolls back on throw. */
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  /** Whether the thread's output or last success predates the source. */
  needsUpdate(threadId, sourceUpdatedAt) {
    const output = this.db.prepare("SELECT source_updated_at FROM stage1_outputs WHERE thread_id = ?").get(threadId);
    if (output && Number(output.source_updated_at) >= sourceUpdatedAt) return false;
    const job = this.db.prepare("SELECT last_success_watermark FROM jobs WHERE kind = ? AND job_key = ?").get(STAGE1, threadId);
    if (job && job.last_success_watermark !== null && Number(job.last_success_watermark) >= sourceUpdatedAt) return false;
    return true;
  }

  /** Number of fresh stage-1 leases. */
  runningStage1Count(now = nowSeconds()) {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS count FROM jobs WHERE kind = ? AND status = 'running' AND lease_until IS NOT NULL AND lease_until > ?",
    ).get(STAGE1, now);
    return Number(row?.count ?? 0);
  }

  /**
   * Claim one stage-1 job.
   * @returns `{ claimed: true, token }` or `{ claimed: false, reason }`.
   */
  claimStage1(threadId, workerId, sourceUpdatedAt, options = {}) {
    const leaseSeconds = Number.isSafeInteger(options.leaseSeconds) ? options.leaseSeconds : 3_600;
    const maxRunning = Number.isSafeInteger(options.maxRunning) ? options.maxRunning : 8;
    const now = nowSeconds();
    return this.transaction(() => {
      if (!this.needsUpdate(threadId, sourceUpdatedAt)) return { claimed: false, reason: "up-to-date" };
      if (this.runningStage1Count(now) >= maxRunning) return { claimed: false, reason: "running" };

      const existing = this.db.prepare("SELECT * FROM jobs WHERE kind = ? AND job_key = ?").get(STAGE1, threadId);
      if (existing) {
        const leaseFresh = existing.status === "running" && existing.lease_until !== null && Number(existing.lease_until) > now;
        if (leaseFresh) return { claimed: false, reason: "running" };
        const advanced = sourceUpdatedAt > Number(existing.input_watermark ?? -1);
        if (!advanced && existing.retry_at !== null && Number(existing.retry_at) > now) return { claimed: false, reason: "retry-backoff" };
        if (!advanced && Number(existing.retry_remaining ?? 0) <= 0) return { claimed: false, reason: "retry-exhausted" };
      }

      const token = randomUUID();
      const leaseUntil = now + leaseSeconds;
      const advanced = sourceUpdatedAt > Number(existing?.input_watermark ?? -1);
      const retryRemaining = existing === undefined || advanced ? RETRY_REMAINING : Number(existing.retry_remaining);
      this.db.prepare(`
        INSERT INTO jobs (
          kind, job_key, status, worker_id, ownership_token, started_at, finished_at,
          lease_until, retry_at, retry_remaining, last_error, input_watermark, last_success_watermark
        ) VALUES (?, ?, 'running', ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, NULL)
        ON CONFLICT(kind, job_key) DO UPDATE SET
          status = 'running',
          worker_id = excluded.worker_id,
          ownership_token = excluded.ownership_token,
          started_at = excluded.started_at,
          finished_at = NULL,
          lease_until = excluded.lease_until,
          retry_at = NULL,
          retry_remaining = excluded.retry_remaining,
          last_error = NULL,
          input_watermark = excluded.input_watermark
      `).run(STAGE1, threadId, workerId, token, now, leaseUntil, retryRemaining, sourceUpdatedAt);
      return { claimed: true, token };
    });
  }

  /** Mark an owned stage-1 job successful and upsert its output. */
  markStage1Succeeded(threadId, token, sourceUpdatedAt, summary, slug, summaryFile, metadata = {}) {
    const now = nowSeconds();
    return this.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE jobs SET status = 'done', finished_at = ?, lease_until = NULL, last_error = NULL,
          last_success_watermark = input_watermark
        WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
      `).run(now, STAGE1, threadId, token).changes;
      if (changed === 0) return false;
      this.db.prepare(`
        INSERT INTO stage1_outputs (
          thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug, generated_at,
          summary_file, cwd, rollout_path, git_branch
        ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          source_updated_at = excluded.source_updated_at,
          raw_memory = excluded.raw_memory,
          rollout_summary = excluded.rollout_summary,
          rollout_slug = excluded.rollout_slug,
          generated_at = excluded.generated_at,
          summary_file = excluded.summary_file,
          cwd = excluded.cwd,
          rollout_path = excluded.rollout_path,
          git_branch = excluded.git_branch
        WHERE excluded.source_updated_at >= stage1_outputs.source_updated_at
      `).run(
        threadId, sourceUpdatedAt, summary, slug ?? null, now, summaryFile ?? null,
        metadata.cwd ?? null, metadata.rolloutPath ?? null, metadata.gitBranch ?? null,
      );
      this.enqueuePhase2(sourceUpdatedAt);
      return true;
    });
  }

  /** Mark an owned stage-1 job successful without touching an existing output. */
  markStage1Skipped(threadId, token) {
    const now = nowSeconds();
    return this.db.prepare(`
      UPDATE jobs SET status = 'done', finished_at = ?, lease_until = NULL, last_error = NULL,
        last_success_watermark = input_watermark
      WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
    `).run(now, STAGE1, threadId, token).changes > 0;
  }

  /** Mark an owned stage-1 job successful when nothing was retained. */
  markStage1NoOutput(threadId, token) {
    const now = nowSeconds();
    return this.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE jobs SET status = 'done', finished_at = ?, lease_until = NULL, last_error = NULL,
          last_success_watermark = input_watermark
        WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
      `).run(now, STAGE1, threadId, token).changes;
      if (changed === 0) return false;
      const deleted = this.db.prepare("DELETE FROM stage1_outputs WHERE thread_id = ?").run(threadId).changes;
      if (deleted > 0) this.enqueuePhase2(Number(this.db.prepare("SELECT input_watermark FROM jobs WHERE kind = ? AND job_key = ?").get(STAGE1, threadId)?.input_watermark ?? now));
      return true;
    });
  }

  /** Mark an owned stage-1 job failed with retry backoff. */
  markStage1Failed(threadId, token, reason, retryDelaySeconds = 3_600) {
    const now = nowSeconds();
    return this.db.prepare(`
      UPDATE jobs SET status = 'error', finished_at = ?, lease_until = NULL, retry_at = ?,
        retry_remaining = retry_remaining - 1, last_error = ?
      WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
    `).run(now, now + retryDelaySeconds, String(reason).slice(0, 2_000), STAGE1, threadId, token).changes > 0;
  }

  /** Advance or enqueue the global phase-2 job. */
  enqueuePhase2(inputWatermark) {
    this.db.prepare(`
      INSERT INTO jobs (
        kind, job_key, status, worker_id, ownership_token, started_at, finished_at,
        lease_until, retry_at, retry_remaining, last_error, input_watermark, last_success_watermark
      ) VALUES (?, ?, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, 0)
      ON CONFLICT(kind, job_key) DO UPDATE SET
        status = CASE WHEN jobs.status = 'running' THEN 'running' ELSE 'pending' END,
        retry_at = CASE WHEN jobs.status = 'running' THEN jobs.retry_at ELSE NULL END,
        retry_remaining = max(jobs.retry_remaining, excluded.retry_remaining),
        input_watermark = CASE
          WHEN excluded.input_watermark > COALESCE(jobs.input_watermark, 0) THEN excluded.input_watermark
          ELSE COALESCE(jobs.input_watermark, 0) + 1
        END
    `).run(PHASE2, PHASE2_KEY, RETRY_REMAINING, inputWatermark);
  }

  /**
   * Claim the singleton phase-2 job.
   * @returns `{ claimed, token?, watermark?, reason? }`.
   */
  claimPhase2(workerId, options = {}) {
    const leaseSeconds = Number.isSafeInteger(options.leaseSeconds) ? options.leaseSeconds : 3_600;
    const cooldownSeconds = Number.isSafeInteger(options.cooldownSeconds) ? options.cooldownSeconds : 21_600;
    const now = nowSeconds();
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM jobs WHERE kind = ? AND job_key = ?").get(PHASE2, PHASE2_KEY);
      if (existing === undefined) {
        const token = randomUUID();
        this.db.prepare(`
          INSERT INTO jobs (
            kind, job_key, status, worker_id, ownership_token, started_at, finished_at,
            lease_until, retry_at, retry_remaining, last_error, input_watermark, last_success_watermark
          ) VALUES (?, ?, 'running', ?, ?, ?, NULL, ?, NULL, ?, NULL, 0, 0)
        `).run(PHASE2, PHASE2_KEY, workerId, token, now, now + leaseSeconds, RETRY_REMAINING);
        return { claimed: true, token, watermark: 0 };
      }
      if (existing.retry_at !== null && Number(existing.retry_at) > now) return { claimed: false, reason: "retry-backoff" };
      if (existing.status === "running" && existing.lease_until !== null && Number(existing.lease_until) > now) return { claimed: false, reason: "running" };
      if (existing.last_error === null && existing.finished_at !== null && Number(existing.finished_at) > now - cooldownSeconds) {
        return { claimed: false, reason: "cooldown" };
      }
      const token = randomUUID();
      const changed = this.db.prepare(`
        UPDATE jobs SET status = 'running', worker_id = ?, ownership_token = ?, started_at = ?,
          finished_at = NULL, lease_until = ?, retry_at = NULL, last_error = NULL
        WHERE kind = ? AND job_key = ?
          AND (status != 'running' OR lease_until IS NULL OR lease_until <= ?)
          AND (retry_at IS NULL OR retry_at <= ?)
          AND (last_error IS NOT NULL OR finished_at IS NULL OR finished_at <= ?)
      `).run(workerId, token, now, now + leaseSeconds, PHASE2, PHASE2_KEY, now, now, now - cooldownSeconds).changes;
      if (changed === 0) return { claimed: false, reason: "running" };
      return { claimed: true, token, watermark: Number(existing.input_watermark ?? 0) };
    });
  }

  /** Extend an owned phase-2 lease. */
  heartbeatPhase2(token, leaseSeconds = 3_600) {
    const now = nowSeconds();
    return this.db.prepare(`
      UPDATE jobs SET lease_until = ? WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
    `).run(now + leaseSeconds, PHASE2, PHASE2_KEY, token).changes > 0;
  }

  /** Mark the owned phase-2 job succeeded and rewrite the selected baseline. */
  markPhase2Succeeded(token, completedWatermark, selectedOutputs) {
    return this.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE jobs SET status = 'done', finished_at = ?, lease_until = NULL, last_error = NULL,
          last_success_watermark = max(COALESCE(last_success_watermark, 0), ?)
        WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
      `).run(nowSeconds(), completedWatermark, PHASE2, PHASE2_KEY, token).changes;
      if (changed === 0) return false;
      this.db.prepare("UPDATE stage1_outputs SET selected_for_phase2 = 0, selected_for_phase2_source_updated_at = NULL WHERE selected_for_phase2 != 0 OR selected_for_phase2_source_updated_at IS NOT NULL").run();
      const select = this.db.prepare("UPDATE stage1_outputs SET selected_for_phase2 = 1, selected_for_phase2_source_updated_at = ? WHERE thread_id = ? AND source_updated_at = ?");
      for (const output of selectedOutputs) select.run(output.sourceUpdatedAt, output.threadId, output.sourceUpdatedAt);
      this.db.prepare("UPDATE consolidation_progress SET max_thread_count = MAX(max_thread_count, ?)").run(selectedOutputs.length);
      return true;
    });
  }

  /** Mark the owned phase-2 job failed with retry backoff. */
  markPhase2Failed(token, reason, retryDelaySeconds = 3_600) {
    const now = nowSeconds();
    return this.db.prepare(`
      UPDATE jobs SET status = 'error', finished_at = ?, lease_until = NULL, retry_at = ?,
        retry_remaining = max(retry_remaining - 1, 0), last_error = ?
      WHERE kind = ? AND job_key = ? AND status = 'running' AND ownership_token = ?
    `).run(now, now + retryDelaySeconds, String(reason).slice(0, 2_000), PHASE2, PHASE2_KEY, token).changes > 0;
  }

  /** Delete stale unselected outputs, stalest first. */
  pruneStage1(maxUnusedDays, limit = 200) {
    if (limit <= 0) return 0;
    const cutoff = nowSeconds() - Math.max(0, maxUnusedDays) * 86_400;
    return this.db.prepare(`
      DELETE FROM stage1_outputs WHERE thread_id IN (
        SELECT thread_id FROM stage1_outputs
        WHERE selected_for_phase2 = 0
          AND COALESCE(last_usage, source_updated_at) < ?
        ORDER BY COALESCE(last_usage, source_updated_at) ASC, source_updated_at ASC, thread_id ASC
        LIMIT ?
      )
    `).run(cutoff, limit).changes;
  }

  /** Read the phase-2 input selection in stable thread-id order. */
  getPhase2InputSelection(limit, maxUnusedDays) {
    if (limit <= 0) return [];
    const cutoff = nowSeconds() - Math.max(0, maxUnusedDays) * 86_400;
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM stage1_outputs
        WHERE (length(trim(raw_memory)) > 0 OR length(trim(rollout_summary)) > 0)
          AND (
            (last_usage IS NOT NULL AND last_usage >= ?)
            OR (last_usage IS NULL AND source_updated_at >= ?)
          )
        ORDER BY COALESCE(usage_count, 0) DESC,
          COALESCE(last_usage, source_updated_at) DESC,
          source_updated_at DESC,
          thread_id DESC
        LIMIT ?
      ) ORDER BY thread_id ASC
    `).all(cutoff, cutoff, limit);
    return rows.map(outputFromRow);
  }

  /** Persist the resolved rollout summary filename for one thread. */
  setSummaryFile(threadId, summaryFile) {
    return this.db.prepare("UPDATE stage1_outputs SET summary_file = ? WHERE thread_id = ?").run(summaryFile, threadId).changes > 0;
  }

  /** All outputs, newest first, for diagnostics/tests. */
  listOutputs() {
    return this.db.prepare("SELECT * FROM stage1_outputs ORDER BY source_updated_at DESC, thread_id DESC").all().map(outputFromRow);
  }

  /** One output by thread id. */
  getOutput(threadId) {
    const row = this.db.prepare("SELECT * FROM stage1_outputs WHERE thread_id = ?").get(threadId);
    return row === undefined ? undefined : outputFromRow(row);
  }

  /** Bump usage counters for cited/read outputs. */
  recordUsage(threadIds) {
    const ids = [...new Set(threadIds)].filter((id) => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return 0;
    const now = nowSeconds();
    const update = this.db.prepare("UPDATE stage1_outputs SET usage_count = COALESCE(usage_count, 0) + 1, last_usage = ? WHERE thread_id = ?");
    return this.transaction(() => ids.reduce((total, id) => total + update.run(now, id).changes, 0));
  }

  /** Resolve the thread that owns one rollout summary file. */
  threadIdForSummaryFile(summaryFile) {
    const row = this.db.prepare("SELECT thread_id FROM stage1_outputs WHERE summary_file = ?").get(summaryFile);
    return row === undefined ? undefined : row.thread_id;
  }

  /** Resolve the thread that owns one rollout summary file and bump usage. */
  recordUsageForSummaryFile(summaryFile) {
    const threadId = this.threadIdForSummaryFile(summaryFile);
    return threadId === undefined ? 0 : this.recordUsage([threadId]);
  }

  /** Delete one thread's output and stage-1 job. */
  deleteOutput(threadId) {
    return this.transaction(() => {
      const deleted = this.db.prepare("DELETE FROM stage1_outputs WHERE thread_id = ?").run(threadId).changes;
      this.db.prepare("DELETE FROM jobs WHERE kind = ? AND job_key = ?").run(STAGE1, threadId);
      return deleted > 0;
    });
  }

  /** Remove all memory state, preserving the root directory. */
  clear() {
    this.transaction(() => {
      this.db.exec("UPDATE consolidation_progress SET max_thread_count = 0");
      this.db.exec("DELETE FROM stage1_outputs");
      this.db.prepare("DELETE FROM jobs WHERE kind = ? OR kind = ?").run(STAGE1, PHASE2);
    });
  }

  /** Close the database handle. */
  close() {
    this.db.close();
  }
}

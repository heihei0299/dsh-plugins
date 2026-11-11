import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../src/store.js";

function withStore(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-store-"));
  const store = new MemoryStore(path.join(dir, "memories_v2_1.sqlite"));
  try {
    return fn(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const now = () => Math.floor(Date.now() / 1000);

test("stage-1 claim, success, and phase-2 selection flags", () => {
  withStore((store) => {
    const source = now();
    const claim = store.claimStage1("session-a", "worker", source, { leaseSeconds: 3600, maxRunning: 2 });
    assert.equal(claim.claimed, true);
    assert.equal(store.markStage1Succeeded("session-a", claim.token, source, "summary", "slug", "file.md", { cwd: "/tmp", rolloutPath: "/tmp/s.jsonl" }), true);
    assert.equal(store.needsUpdate("session-a", source), false);
    const output = store.getOutput("session-a");
    assert.equal(output.rolloutSummary, "summary");
    assert.equal(output.summaryFile, "file.md");
    assert.equal(output.cwd, "/tmp");
    assert.equal(output.selectedForPhase2, false);

    const selection = store.getPhase2InputSelection(10, 30);
    assert.deepEqual(selection.map((entry) => entry.threadId), ["session-a"]);
    const phase2 = store.claimPhase2("worker", { leaseSeconds: 3600, cooldownSeconds: 0 });
    assert.equal(phase2.claimed, true);
    assert.equal(store.markPhase2Succeeded(phase2.token, source, selection), true);
    assert.equal(store.getOutput("session-a").selectedForPhase2, true);
  });
});

test("one live lease per thread and retry backoff", () => {
  withStore((store) => {
    const source = now();
    const first = store.claimStage1("session-a", "worker", source, { leaseSeconds: 3600, maxRunning: 2 });
    assert.equal(first.claimed, true);
    assert.deepEqual(store.claimStage1("session-a", "worker", source, { leaseSeconds: 3600, maxRunning: 2 }), { claimed: false, reason: "running" });
    assert.equal(store.markStage1Failed("session-a", first.token, "boom", 3600), true);
    assert.deepEqual(store.claimStage1("session-a", "worker", source, { leaseSeconds: 3600, maxRunning: 2 }), { claimed: false, reason: "retry-backoff" });
  });
});

test("retention prunes only unselected stale output", () => {
  withStore((store) => {
    const old = now() - 60 * 86_400;
    for (const id of ["session-a", "session-b"]) {
      const claim = store.claimStage1(id, "worker", old, { leaseSeconds: 3600, maxRunning: 4 });
      assert.equal(store.markStage1Succeeded(id, claim.token, old, "summary", "slug", `${id}.md`), true);
    }
    assert.equal(store.pruneStage1(30, 200), 2);
    assert.equal(store.getOutput("session-a"), undefined);
  });
});

test("usage counters resolve summary files", () => {
  withStore((store) => {
    const source = now();
    const claim = store.claimStage1("session-a", "worker", source, { leaseSeconds: 3600, maxRunning: 2 });
    store.markStage1Succeeded("session-a", claim.token, source, "summary", "slug", "file.md");
    assert.equal(store.recordUsageForSummaryFile("file.md"), 1);
    assert.equal(store.recordUsageForSummaryFile("file.md"), 1);
    assert.equal(store.getOutput("session-a").usageCount, 2);
  });
});
test("opens a Codex-shaped memories_v2 database and adds DSH provenance columns", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-migrate-"));
  const dbPath = path.join(dir, "memories_v2_1.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE stage1_outputs (
      thread_id TEXT PRIMARY KEY,
      source_updated_at INTEGER NOT NULL,
      raw_memory TEXT NOT NULL,
      rollout_summary TEXT NOT NULL,
      rollout_slug TEXT,
      generated_at INTEGER NOT NULL,
      usage_count INTEGER,
      last_usage INTEGER,
      selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
      selected_for_phase2_source_updated_at INTEGER
    );
    CREATE TABLE jobs (
      kind TEXT NOT NULL, job_key TEXT NOT NULL, status TEXT NOT NULL, worker_id TEXT,
      ownership_token TEXT, started_at INTEGER, finished_at INTEGER, lease_until INTEGER,
      retry_at INTEGER, retry_remaining INTEGER NOT NULL, last_error TEXT,
      input_watermark INTEGER, last_success_watermark INTEGER, PRIMARY KEY (kind, job_key)
    );
    CREATE TABLE consolidation_progress (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      max_thread_count INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO stage1_outputs (thread_id, source_updated_at, raw_memory, rollout_summary, generated_at)
      VALUES ('session-a', 1700000000, '', 'legacy summary', 1700000000);
  `);
  db.close();
  const store = new MemoryStore(dbPath);
  try {
    const output = store.getOutput("session-a");
    assert.equal(output.rolloutSummary, "legacy summary");
    assert.equal(output.summaryFile, undefined);
    assert.equal(store.markStage1Succeeded("session-a", "missing-token", 1700000000, "x", "s", "f.md"), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { MemoryEngine } from "../src/engine.js";
import { MemoryStore } from "../src/store.js";
import { readBaseline, readSummary } from "../src/workspace.js";
import { applyImport, parseSummaryHeader, planImport } from "../scripts/import-codex-memories.mjs";

const THREAD = "11111111-1111-4111-8111-111111111111";
const FILE = "2026-11-11T06-37-47-abcd-flaky.md";

function summaryText() {
  return [
    "v1",
    "",
    "## User Profile",
    "A developer.",
    "",
    "## User preferences",
    "- prefers focused checks",
    "",
    "## General Tips",
    "- run the narrow test",
    "",
    "## What's in Memory",
    "### /repo",
    "#### 2026-11-11",
    `- rollout_summaries/${FILE} — flaky test history; thread_id=${THREAD}`,
    "",
  ].join("\n");
}

function rolloutText() {
  return [
    `thread_id: ${THREAD}`,
    "updated_at: 2026-11-11T06:37:47Z",
    "rollout_path: /home/me/.codex/sessions/rollout.jsonl",
    "cwd: /repo",
    "git_branch: main",
    "",
    "## Task",
    "Fix the flaky test.",
    "",
  ].join("\n");
}

function makeSource(home) {
  const codexHome = path.join(home, "codex");
  const root = path.join(codexHome, "memories_v2");
  mkdirSync(path.join(root, "rollout_summaries"), { recursive: true });
  mkdirSync(path.join(root, "extensions", "ad_hoc", "notes"), { recursive: true });
  writeFileSync(path.join(root, "memory_summary.md"), summaryText());
  writeFileSync(path.join(root, "rollout_summaries", FILE), rolloutText());
  writeFileSync(path.join(root, "extensions", "ad_hoc", "notes", "note.md"), "remember this\n");

  const dbPath = path.join(codexHome, "memories_v2_1.sqlite");
  const store = new MemoryStore(dbPath);
  store.close();
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO stage1_outputs (
      thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug,
      generated_at, usage_count, last_usage, selected_for_phase2,
      selected_for_phase2_source_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
  `).run(
    THREAD,
    1_700_000_000,
    "",
    "## Task\nFix the flaky test.",
    "flaky",
    1_700_000_100,
    3,
    1_700_000_200,
  );
  db.close();
  return { codexHome, root, dbPath };
}

test("parses rollout summary provenance headers", () => {
  const parsed = parseSummaryHeader(rolloutText());
  assert.equal(parsed.thread_id, THREAD);
  assert.equal(parsed.cwd, "/repo");
  assert.equal(parsed.git_branch, "main");
  assert.match(parsed.body, /Fix the flaky test/);
});

test("imports Codex rows, files, and a clean baseline without the DB", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-import-"));
  try {
    const source = makeSource(home);
    const dshHome = path.join(home, "dsh");
    const plan = planImport({ codexHome: source.codexHome, dshHome });
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.rows, 1);
    assert.equal(plan.files, 1);
    assert.equal(plan.imports.length, 1);
    assert.equal(plan.missingPointers.length, 0);
    assert.equal(existsSync(plan.destRoot), false);

    const result = applyImport(plan);
    assert.equal(result.imported, 1);
    assert.equal(result.summaryValid, true);

    const root = path.join(dshHome, "memories_v2");
    assert.equal(readSummary(root).valid, true);
    assert.equal(existsSync(path.join(root, "rollout_summaries", FILE)), true);
    assert.equal(existsSync(path.join(root, "extensions", "ad_hoc", "notes", "note.md")), true);

    const store = new MemoryStore(path.join(root, "memories_v2_1.sqlite"));
    const output = store.getOutput(THREAD);
    assert.equal(output.origin, "codex");
    assert.equal(output.imported, true);
    assert.equal(output.summaryFile, FILE);
    assert.equal(output.usageCount, 3);
    assert.equal(output.lastUsage > 1_700_000_200, true);
    assert.equal(output.selectedForPhase2, true);
    store.close();

    const baseline = readBaseline(root);
    assert.ok(Object.keys(baseline.files).includes("memory_summary.md"));
    assert.ok(Object.keys(baseline.files).includes(`rollout_summaries/${FILE}`));
    assert.equal(Object.keys(baseline.files).some((file) => file.startsWith("memories_v2_1.sqlite")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("imported rows survive session-existence pruning while native rows do not", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-import-prune-"));
  try {
    const source = makeSource(home);
    const dshHome = path.join(home, "dsh");
    const plan = planImport({ codexHome: source.codexHome, dshHome });
    applyImport(plan);

    const config = readConfig({ home: dshHome, maxUnusedDays: 3650 });
    const store = new MemoryStore(config.dbPath);
    const claim = store.claimStage1("session-native", "worker", 1_700_000_000, { leaseSeconds: 3600, maxRunning: 4 });
    assert.equal(claim.claimed, true);
    assert.equal(store.markStage1Succeeded("session-native", claim.token, 1_700_000_000, "native", "native", "native.md"), true);

    const engine = new MemoryEngine({
      config,
      llm: {},
      persistence: { async stat() { return undefined; } },
      logger: {},
      store,
    });
    await engine.pruneMissingSessions(store);
    assert.equal(store.getOutput(THREAD)?.imported, true);
    assert.equal(store.getOutput("session-native"), undefined);
    store.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("refuses a non-empty destination", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-import-dest-"));
  try {
    const source = makeSource(home);
    const dshHome = path.join(home, "dsh");
    const plan = planImport({ codexHome: source.codexHome, dshHome });
    mkdirSync(plan.destRoot, { recursive: true });
    writeFileSync(path.join(plan.destRoot, "keep.txt"), "keep\n");
    assert.throws(() => applyImport(plan), /destination is not empty/);
    assert.equal(readFileSync(path.join(plan.destRoot, "keep.txt"), "utf8"), "keep\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

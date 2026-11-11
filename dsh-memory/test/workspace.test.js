import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  commitBaseline,
  currentManifest,
  diffManifests,
  ensureLayout,
  memoryPaths,
  readBaseline,
  readSummary,
  sanitizeSlug,
  summaryFileName,
  syncSummaries,
  validateSummary,
  writeSummary,
  writeWorkspaceDiff,
} from "../src/workspace.js";

function withRoot(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-ws-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const output = (threadId, overrides = {}) => ({
  threadId,
  sourceUpdatedAt: 1_700_000_000,
  rolloutSummary: "## Task\nDid the thing.",
  rolloutSlug: "Fix Flaky Test",
  summaryFile: undefined,
  cwd: "/repo",
  rolloutPath: "/tmp/session.jsonl",
  ...overrides,
});

test("summary filenames are stable, sanitized, and slug-capped", () => {
  assert.equal(sanitizeSlug("Fix Flaky Test"), "fix_flaky_test");
  const name = summaryFileName(output("session-a"));
  assert.match(name, /^2023-11-14T22-13-20-[A-Za-z0-9]{4}-fix_flaky_test\.md$/);
  assert.equal(summaryFileName(output("session-a")), name);
});

test("sync writes selected summaries and prunes stale files", () => {
  withRoot((root) => {
    ensureLayout(root);
    const first = syncSummaries(root, [output("session-a")]);
    assert.equal(first.length, 1);
    assert.equal(readFileSync(path.join(memoryPaths(root).rolloutSummaries, first[0].summaryFile), "utf8").includes("thread_id: session-a"), true);
    const second = syncSummaries(root, [output("session-b", { sourceUpdatedAt: 1_700_000_100 })]);
    const dir = memoryPaths(root).rolloutSummaries;
    assert.equal(readFileSync(path.join(dir, second[0].summaryFile), "utf8").includes("thread_id: session-b"), true);
  });
});

test("summary validation enforces the v2 schema", () => {
  const valid = "v1\n\n## User Profile\nA user.\n\n## User preferences\n- one\n\n## General Tips\n- two\n\n## What's in Memory\n- three\n";
  assert.equal(validateSummary(valid).ok, true);
  assert.equal(validateSummary("v2\n## User Profile").ok, false);
  assert.equal(validateSummary(valid.replace("## General Tips", "## Tips")).ok, false);
  assert.equal(validateSummary("x".repeat(10_001)).ok, false);
});

test("writeSummary/readSummary round-trip", () => {
  withRoot((root) => {
    ensureLayout(root);
    writeSummary(root, "v1\n\n## User Profile\nA\n\n## User preferences\n- b\n\n## General Tips\n- c\n\n## What's in Memory\n- d");
    const read = readSummary(root);
    assert.equal(read.valid, true);
    assert.match(read.summary, /## What's in Memory/);
  });
});

test("baseline diff sees additions, modifications, and deletions", () => {
  withRoot((root) => {
    ensureLayout(root);
    const paths = memoryPaths(root);
    writeFileSync(path.join(paths.rolloutSummaries, "a.md"), "one\n");
    writeFileSync(path.join(paths.rolloutSummaries, "b.md"), "two\n");
    const before = currentManifest(root);
    commitBaseline(root, before);
    assert.deepEqual(readBaseline(root).files, before.files);
    writeFileSync(path.join(paths.rolloutSummaries, "a.md"), "one changed\n");
    writeFileSync(path.join(paths.rolloutSummaries, "c.md"), "three\n");
    rmSync(path.join(paths.rolloutSummaries, "b.md"));
    const after = currentManifest(root);
    const diff = diffManifests(before, after);
    assert.deepEqual(diff.added, ["rollout_summaries/c.md"]);
    assert.deepEqual(diff.modified, ["rollout_summaries/a.md"]);
    assert.deepEqual(diff.deleted, ["rollout_summaries/b.md"]);
    const rendered = writeWorkspaceDiff(root, before, after);
    assert.match(rendered.text, /- A rollout_summaries\/c\.md/);
    assert.match(rendered.text, /- M rollout_summaries\/a\.md/);
    assert.match(rendered.text, /- D rollout_summaries\/b\.md/);
  });
});

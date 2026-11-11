import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { runPhase2 } from "../src/phase2.js";
import { memoryPaths, readBaseline, readSummary } from "../src/workspace.js";

const VALID = [
  "v1",
  "",
  "## User Profile",
  "A developer working in /repo.",
  "",
  "## User preferences",
  "- prefers small, verified changes",
  "",
  "## General Tips",
  "- run the narrow test first",
  "",
  "## What's in Memory",
  "### /repo",
  "#### 2026-11-11",
  "- flaky test: retry",
  "",
].join("\n");

function seed(store, threadId, when) {
  const claim = store.claimStage1(threadId, "worker", when, { leaseSeconds: 3600, maxRunning: 4 });
  assert.equal(claim.claimed, true);
  const file = `${threadId}.md`;
  assert.equal(store.markStage1Succeeded(threadId, claim.token, when, "summary " + threadId, "slug", file, { cwd: "/repo", rolloutPath: `/tmp/${threadId}.jsonl` }), true);
  return file;
}

function fakeLlm(outputs) {
  const requests = [];
  return {
    requests,
    stream(request) {
      requests.push(request);
      const text = outputs.shift() ?? JSON.stringify({ memory_summary: VALID });
      return (async function* () {
        yield { type: "text-delta", index: 0, text };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
}

test("consolidates selected summaries, writes memory_summary.md, and advances the baseline", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-p2-"));
  const store = new MemoryStore(path.join(home, "state.sqlite"));
  try {
    const config = readConfig({ home, phase2CooldownSeconds: 0, maxUnusedDays: 3650 });
    const when = Math.floor(Date.now() / 1000);
    seed(store, "session-a", when);
    seed(store, "session-b", when + 1);
    const llm = fakeLlm([JSON.stringify({ memory_summary: VALID })]);
    const result = await runPhase2({ store, llm, config, route: { provider: "fake", model: "model" }, workerId: "worker" });
    assert.equal(result.status, "succeeded");
    assert.equal(result.selected, 2);
    const summary = readSummary(config.root);
    assert.equal(summary.valid, true);
    assert.match(summary.summary, /prefers small/);
    assert.equal(existsSync(memoryPaths(config.root).workspaceDiff), false);
    const baseline = readBaseline(config.root);
    assert.ok(Object.keys(baseline.files).some((file) => file === "memory_summary.md"));
    assert.ok(Object.keys(baseline.files).some((file) => file.startsWith("rollout_summaries/")));
    assert.equal(store.listOutputs().every((output) => output.selectedForPhase2), true);

    const second = await runPhase2({ store, llm, config, route: { provider: "fake", model: "model" }, workerId: "worker" });
    assert.equal(second.status, "no-changes");

    store.deleteOutput("session-b");
    const third = await runPhase2({ store, llm, config, route: { provider: "fake", model: "model" }, workerId: "worker" });
    assert.equal(third.status, "succeeded");
    assert.equal(llm.requests.length, 2);
    assert.equal(readSummary(config.root).valid, true);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects an invalid summary and keeps the previous artifacts", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-p2-"));
  const store = new MemoryStore(path.join(home, "state.sqlite"));
  try {
    const config = readConfig({ home, phase2CooldownSeconds: 0, maxUnusedDays: 3650 });
    seed(store, "session-a", Math.floor(Date.now() / 1000));
    const llm = fakeLlm([JSON.stringify({ memory_summary: "v2\nno headings" })]);
    const result = await runPhase2({ store, llm, config, route: { provider: "fake", model: "model" }, workerId: "worker" });
    assert.equal(result.status, "failed");
    assert.match(result.reason, /invalid consolidated summary/);
    assert.equal(existsSync(memoryPaths(config.root).summary), false);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("writes a minimal valid summary when no evidence remains", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-p2-"));
  const store = new MemoryStore(path.join(home, "state.sqlite"));
  try {
    const config = readConfig({ home, phase2CooldownSeconds: 0, maxUnusedDays: 3650 });
    const llm = fakeLlm([]);
    const result = await runPhase2({ store, llm, config, route: { provider: "fake", model: "model" }, workerId: "worker" });
    assert.equal(result.status, "succeeded");
    assert.equal(result.minimal, true);
    assert.equal(llm.requests.length, 0);
    assert.equal(readSummary(config.root).valid, true);
  } finally {
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

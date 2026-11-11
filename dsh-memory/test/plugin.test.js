import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { apply } from "../index.js";
import { memoryPaths } from "../src/config.js";

const SUMMARY = [
  "v1",
  "",
  "## User Profile",
  "A developer.",
  "",
  "## User preferences",
  "- prefers narrow verification",
  "",
  "## General Tips",
  "- run the focused test",
  "",
  "## What's in Memory",
  "### /repo",
  "#### 2026-11-11",
  "- flaky: retry",
  "",
].join("\n");

function fakeContext({ llm, persistence }) {
  const effects = [];
  const sections = [];
  const tools = [];
  const listeners = new Map();
  const ctx = {
    logger: { info() {}, warn() {} },
    llm,
    sessionPersistence: persistence,
    systemPrompt: {
      section(section) {
        sections.push(section);
        return () => {};
      },
      getSectionOrder() {
        return 900;
      },
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
    on(event, handler) {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
    effect(factory) {
      effects.push(factory());
    },
  };
  return {
    ctx,
    sections,
    tools,
    emit(event, ...args) {
      return listeners.get(event)?.(...args);
    },
    dispose() {
      for (const dispose of effects) dispose?.();
    },
  };
}

function fakePersistence(home) {
  const now = Date.now();
  const file = path.join(home, "session-a.jsonl");
  writeFileSync(file, "x");
  utimesSync(file, new Date(now - 7 * 3_600_000), new Date(now - 7 * 3_600_000));
  const events = [
    { seq: 0, time: 1, type: "user/message", data: { role: "user", content: [{ type: "text", text: "Fix the flaky test." }], source: { kind: "user" } } },
    { seq: 1, time: 2, type: "assistant/message", data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "Done." }] } } },
  ];
  const snapshot = {
    header: { version: 4, id: "session-a", createdAt: now - 7 * 3_600_000, cwd: "/repo", isSeeded: false },
    location: { kind: "jsonl", path: file },
    eventCount: events.length,
  };
  return {
    async list() {
      return [snapshot];
    },
    async stat() {
      return snapshot;
    },
    async open() {
      return {
        async read(offset = 0, length) {
          return { events: events.slice(offset, length === undefined ? undefined : offset + length) };
        },
        async close() {},
      };
    },
  };
}

function fakeLlm() {
  return {
    stream(request) {
      const response = request.system?.includes("consolidate") || request.system?.includes("You consolidate")
        ? JSON.stringify({ memory_summary: SUMMARY })
        : JSON.stringify({ rollout_summary: "## Task\nFix the flaky test.", rollout_slug: "flaky" });
      return (async function* () {
        yield { type: "text-delta", index: 0, text: response };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
}

test("mounts the prompt section, optional tools, and runs on root startup", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-plugin-"));
  const harness = fakeContext({ llm: fakeLlm(), persistence: fakePersistence(home) });
  const engine = apply(harness.ctx, {
    home,
    phase2CooldownSeconds: 0,
    maxUnusedDays: 3650,
    dedicatedTools: true,
  });
  try {
    assert.equal(harness.sections.length, 1);
    assert.equal(harness.tools.length, 4);
    assert.equal(harness.sections[0].text().includes("## Memory"), false);

    const agent = {
      id: "session-current",
      options: { provider: "fake", model: "model" },
      model: { current: () => ({ provider: "fake", model: "model" }) },
      session: { header: { version: 4, id: "session-current", createdAt: Date.now(), cwd: "/repo", isSeeded: false } },
    };
    harness.emit("agent/created", { agent, source: "startup" });
    await engine.whenIdle();

    assert.equal(existsSync(memoryPaths(path.join(home, "memories_v2")).summary), true);
    const text = harness.sections[0].text();
    assert.match(text, /## Memory/);
    assert.match(text, /prefers narrow verification/);
    assert.match(text, /MEMORY_SUMMARY BEGINS/);

    assert.equal(harness.tools[0].name, "memory_read");
    const list = await harness.tools[2].execute({ path: "rollout_summaries" }, { signal: new AbortController().signal });
    assert.ok(list.entries.length >= 1);

    const output = engine.store.listOutputs()[0];
    harness.emit("session/event", {}, {
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: `Used memory.\n<oai-mem-citation><citation_entries>rollout_summaries/${output.summaryFile}:1-2|note=[x]</citation_entries><rollout_ids>${output.threadId}</rollout_ids></oai-mem-citation>` }] } },
    });
    assert.equal(engine.store.getOutput(output.threadId).usageCount, 1);
  } finally {
    harness.dispose();
    await engine.whenIdle();
    rmSync(home, { recursive: true, force: true });
  }
});

test("does not schedule for subagent or non-start sources", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-plugin-"));
  const harness = fakeContext({ llm: fakeLlm(), persistence: fakePersistence(home) });
  const engine = apply(harness.ctx, { home, dedicatedTools: false });
  try {
    const subagent = {
      id: "session-child",
      model: { current: () => ({ provider: "fake", model: "model" }) },
      session: { header: { version: 4, id: "session-child", createdAt: Date.now(), isSeeded: false, origin: "subagent", delegationDepth: 1 } },
    };
    harness.emit("agent/created", { agent: subagent, source: "startup" });
    await engine.whenIdle();
    assert.equal(engine.runs, 0);
  } finally {
    harness.dispose();
    await engine.whenIdle();
    rmSync(home, { recursive: true, force: true });
  }
});

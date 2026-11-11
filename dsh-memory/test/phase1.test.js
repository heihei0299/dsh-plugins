import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import { runPhase1, listCandidates, hasExternalContext } from "../src/phase1.js";

function fakePersistence(sessions) {
  return {
    async list() {
      return sessions.map((session) => ({
        header: session.header,
        location: { kind: "jsonl", path: session.path },
        eventCount: session.events.length,
      }));
    },
    async stat(id) {
      const session = sessions.find((entry) => entry.header.id === id);
      return session === undefined ? undefined : { header: session.header, location: { kind: "jsonl", path: session.path }, eventCount: session.events.length };
    },
    async open(id) {
      const session = sessions.find((entry) => entry.header.id === id);
      let cursor = 0;
      return {
        async read(offset = 0, length) {
          const start = offset ?? 0;
          const end = length === undefined ? session.events.length : start + length;
          return { events: session.events.slice(start, end) };
        },
        async close() {},
      };
    },
  };
}

function eventsFor(text) {
  return [
    { seq: 0, time: 1, type: "turn/start", data: { turn: 1 } },
    { seq: 1, time: 2, type: "user/message", data: { role: "user", content: [{ type: "text", text }], source: { kind: "user" } } },
    { seq: 2, time: 3, type: "assistant/message", data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text: "Done." }] } } },
  ];
}

function fakeLlm(outputs) {
  const requests = [];
  return {
    requests,
    stream(request) {
      requests.push(request);
      const text = outputs.shift() ?? JSON.stringify({ rollout_summary: "summary", rollout_slug: "slug" });
      return (async function* () {
        yield { type: "text-delta", index: 0, text };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
}

function setup() {
  const home = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-p1-"));
  const now = Date.now();
  const old = new Date(now - 7 * 3_600_000);
  const make = (id, text, options = {}) => {
    const file = path.join(home, `${id}.jsonl`);
    writeFileSync(file, "x");
    utimesSync(file, options.mtime ?? old, options.mtime ?? old);
    return {
      header: { version: 4, id, createdAt: now - 7 * 3_600_000, cwd: "/repo", isSeeded: false, ...options.header },
      events: eventsFor(text),
      path: file,
    };
  };
  return {
    home,
    sessions: [
      make("session-a", "Fix the flaky test."),
      make("session-b", "Add a parser."),
      make("session-fresh", "Too recent.", { mtime: new Date(now - 3_600_000) }),
      make("session-child", "Subagent.", { header: { origin: "subagent", delegationDepth: 1, parentSession: "session-a" } }),
    ],
  };
}

test("lists only idle, in-window root sessions and excludes the current one", async () => {
  const { home, sessions } = setup();
  try {
    const config = readConfig({ home });
    const candidates = await listCandidates(fakePersistence(sessions), config, "session-b");
    assert.deepEqual(candidates.map((entry) => entry.sessionId), ["session-a"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("extraction claims, upserts output, and does not re-extract", async () => {
  const { home, sessions } = setup();
  try {
    const config = readConfig({ home, maxRolloutsPerStartup: 2 });
    const store = new MemoryStore(path.join(home, "state.sqlite"));
    const llm = fakeLlm([
      JSON.stringify({ rollout_summary: "## Task\nFix the flaky test. API_KEY={{API_KEY_aaaabbbb}}", rollout_slug: "flaky" }),
      JSON.stringify({ rollout_summary: "## Task\nAdd a parser.", rollout_slug: "parser" }),
    ]);
    const stats = await runPhase1({
      store,
      persistence: fakePersistence(sessions),
      llm,
      config,
      route: { provider: "fake", model: "model" },
      currentSessionId: "session-current",
    });
    assert.equal(stats.claimed, 2);
    assert.equal(stats.succeeded, 2);
    assert.equal(store.listOutputs().length, 2);
    assert.match(store.getOutput("session-a").rolloutSummary, /REDACTED_SECRET/);
    assert.equal(store.getOutput("session-a").summaryFile.endsWith("-flaky.md"), true);

    const second = await runPhase1({
      store,
      persistence: fakePersistence(sessions),
      llm: fakeLlm([]),
      config,
      route: { provider: "fake", model: "model" },
    });
    assert.equal(second.claimed, 0);
    store.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("empty model output advances the job without storing a summary", async () => {
  const { home, sessions } = setup();
  try {
    const config = readConfig({ home, maxRolloutsPerStartup: 1 });
    const store = new MemoryStore(path.join(home, "state.sqlite"));
    const stats = await runPhase1({
      store,
      persistence: fakePersistence([sessions[0]]),
      llm: fakeLlm([JSON.stringify({ rollout_summary: "", rollout_slug: "" })]),
      config,
      route: { provider: "fake", model: "model" },
    });
    assert.equal(stats.noOutput, 1);
    assert.equal(store.getOutput("session-a"), undefined);
    store.close();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("detects external-context tool calls", () => {
  assert.equal(hasExternalContext([{ type: "tool/call", data: { name: "web_search" } }]), true);
  assert.equal(hasExternalContext([{ type: "tool/call", data: { name: "mcp__server__tool" } }]), true);
  assert.equal(hasExternalContext([{ type: "tool/call", data: { name: "bash" } }]), false);
});

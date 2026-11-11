import test from "node:test";
import assert from "node:assert/strict";
import { renderTranscript, truncateText, __internals } from "../src/transcript.js";

const event = (seq, type, data) => ({ seq, time: seq, type, data });

test("renders human, final, and tool evidence with provenance labels", () => {
  const text = renderTranscript([
    event(1, "user/message", { role: "user", content: [{ type: "text", text: "Please fix the flaky test." }], source: { kind: "user" } }),
    event(2, "assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "I will inspect the retry loop." }, { type: "tool-call", name: "bash", arguments: "{\"command\":\"npm test\"}" }] } }),
    event(3, "tool/result", { message: { role: "tool", toolCallId: "c1", content: [{ type: "text", text: "1 failing" }], isError: false } }),
    event(4, "assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "The retry loop swallowed the error." }] } }),
  ]);
  assert.match(text, /\[human user\]/);
  assert.match(text, /Please fix the flaky test/);
  assert.match(text, /\[assistant commentary\]/);
  assert.match(text, /\[tool\]/);
  assert.match(text, /npm test/);
  assert.match(text, /\[assistant final\]/);
});

test("drops AGENTS.md and skill context, keeps runtime context", () => {
  const text = renderTranscript([
    event(1, "user/message", { role: "user", content: [{ type: "text", text: "# AGENTS.md instructions\n<INSTRUCTIONS>rules</INSTRUCTIONS>" }], source: { kind: "agent-instruction" } }),
    event(2, "user/message", { role: "user", content: [{ type: "text", text: "<skill_content name=\"x\">secret</skill_content>" }], source: { kind: "skill" } }),
    event(3, "user/message", { role: "user", content: [{ type: "text", text: "Current working directory: /repo" }], source: { kind: "runtime-context" } }),
    event(4, "user/message", { role: "user", content: [{ type: "text", text: "real ask" }], source: { kind: "user" } }),
  ]);
  assert.doesNotMatch(text, /rules/);
  assert.doesNotMatch(text, /secret/);
  assert.match(text, /harness context/);
  assert.match(text, /real ask/);
});

test("redacts credentials before rendering", () => {
  const text = renderTranscript([
    event(1, "user/message", { role: "user", content: [{ type: "text", text: "export API_KEY=sk-abcdefghijklmnopqrstuvwx and token=ghp_abcdefghijklmnopqrstuvwxyz123456" }], source: { kind: "user" } }),
  ]);
  assert.match(text, /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(text, /sk-abcdefghijklmnopqrstuvwx/);
  assert.doesNotMatch(text, /ghp_abcdefghijklmnopqrstuvwxyz123456/);
});

test("honors the byte budget and marks gaps", () => {
  const events = [];
  for (let index = 0; index < 20; index += 1) {
    events.push(event(index, "user/message", { role: "user", content: [{ type: "text", text: `message ${index} ${"x".repeat(500)}` }], source: { kind: "user" } }));
  }
  const text = renderTranscript(events, { maxInputBytes: 2_500, maxRowBytes: 400 });
  assert.ok(Buffer.byteLength(text, "utf8") <= 2_500);
  assert.match(text, /evidence omitted/);
});

test("truncateText keeps utf-8 boundaries", () => {
  const text = "记忆".repeat(100);
  const result = truncateText(text, 40);
  assert.ok(Buffer.byteLength(result, "utf8") <= 40);
  assert.match(result, /truncated/);
});
test("does not duplicate a tool call logged in both assistant content and tool/call", () => {
  const text = renderTranscript([
    event(1, "assistant/message", { message: { role: "assistant", content: [{ type: "tool-call", id: "call-1", name: "bash", arguments: "{}" }] } }),
    event(2, "tool/call", { callId: "call-1", name: "bash", arguments: "{}" }),
    event(3, "tool/result", { message: { role: "tool", toolCallId: "call-1", content: [{ type: "text", text: "ok" }], isError: false } }),
  ]);
  assert.equal((text.match(/\[tool\]/g) ?? []).length, 2);
});
test("drops workspace instruction reminders but keeps ordinary context reminders", () => {
  const text = renderTranscript([
    event(1, "user/message", { role: "user", content: [{ type: "text", text: "<system-reminder>\nInstructions from: ~/.dsh/AGENTS.md\nrule\n</system-reminder>" }] }),
    event(2, "user/message", { role: "user", content: [{ type: "text", text: "<system-reminder>\nCurrent runtime context: cwd /repo\n</system-reminder>" }] }),
  ]);
  assert.doesNotMatch(text, /~\/\.dsh\/AGENTS\.md/);
  assert.match(text, /Current runtime context/);
});

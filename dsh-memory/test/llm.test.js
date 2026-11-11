import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonObject, parseStageOneOutput, parseConsolidationOutput, completeText } from "../src/llm.js";

test("parses fenced and prefixed JSON objects", () => {
  assert.deepEqual(parseJsonObject("\`\`\`json\n{\"a\":1}\n\`\`\`"), { a: 1 });
  assert.deepEqual(parseJsonObject("Here is the result: {\"a\":2} thanks"), { a: 2 });
  assert.throws(() => parseJsonObject("no object"), /no JSON object/);
});

test("parses stage-one and consolidation payloads", () => {
  assert.deepEqual(parseStageOneOutput('{"rollout_summary":"s","rollout_slug":"x"}'), { summary: "s", slug: "x" });
  assert.equal(parseConsolidationOutput('{"memory_summary":"v1"}'), "v1");
  assert.throws(() => parseConsolidationOutput('{"other":"x"}'), /no memory_summary/);
});

test("completeText assembles deltas and rejects error finishes", async () => {
  const llm = {
    stream(request) {
      return (async function* () {
        yield { type: "text-delta", index: 0, text: "hello " };
        yield { type: "text-delta", index: 0, text: "world" };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
  assert.equal(await completeText(llm, { provider: "p", model: "m", system: "s", prompt: "x" }), "hello world");
  const failing = {
    stream() {
      return (async function* () {
        yield { type: "finish", reason: { kind: "error", failure: { message: "boom" } } };
      })();
    },
  };
  await assert.rejects(completeText(failing, { provider: "p", model: "m", system: "s", prompt: "x" }), /boom/);
});
test("completeText falls back to completed text blocks", async () => {
  const llm = {
    stream() {
      return (async function* () {
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "block-end", index: 0, block: { type: "text", text: "from block" } };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
  assert.equal(await completeText(llm, { provider: "p", model: "m", system: "s", prompt: "x" }), "from block");
});

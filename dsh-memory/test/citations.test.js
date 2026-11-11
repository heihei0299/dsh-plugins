import test from "node:test";
import assert from "node:assert/strict";
import { parseMemoryCitation } from "../src/citations.js";

test("extracts summary paths and thread ids from a citation block", () => {
  const text = "Answer.\n<oai-mem-citation>\n<citation_entries>\nrollout_summaries/a.md:1-2|note=[x]\nMEMORY.md:3-4|note=[ignored]\nrollout_summaries/b.md:5-6|note=[y]\n</citation_entries>\n<rollout_ids>\nsession-a\nsession-b\nsession-a\n</rollout_ids>\n</oai-mem-citation>";
  const parsed = parseMemoryCitation(text);
  assert.deepEqual(parsed.paths, ["rollout_summaries/a.md", "rollout_summaries/b.md"]);
  assert.deepEqual(parsed.ids, ["session-a", "session-b"]);
});

test("accepts legacy thread_ids and ignores malformed text", () => {
  assert.deepEqual(parseMemoryCitation("<oai-mem-citation><thread_ids>t1</thread_ids></oai-mem-citation>").ids, ["t1"]);
  assert.deepEqual(parseMemoryCitation("no citations"), { paths: [], ids: [] });
});

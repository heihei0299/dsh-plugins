import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addAdHocNote, listMemoryFiles, readMemoryFile, safePath, searchMemoryFiles } from "../src/tools.js";

function withRoot(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "dsh-memory-tools-"));
  try {
    writeFileSync(path.join(root, "memory_summary.md"), "v1\nfirst\nsecond\n");
    mkdirSync(path.join(root, "rollout_summaries"));
    writeFileSync(path.join(root, "rollout_summaries", "a.md"), "thread_id: session-a\nneedle here\n");
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("safePath rejects absolute, parent, hidden, and symlink escapes", () => {
  withRoot((root) => {
    assert.throws(() => safePath(root, "/etc/passwd"), /relative/);
    assert.throws(() => safePath(root, "../outside"), /hidden or parent/);
    assert.throws(() => safePath(root, ".dsh-memory-baseline.json"), /hidden or parent/);
    symlinkSync("/etc/passwd", path.join(root, "leak"));
    assert.throws(() => safePath(root, "leak"), /symlink/);
  });
});

test("read returns a line window and list hides hidden entries", () => {
  withRoot((root) => {
    const read = readMemoryFile(root, "memory_summary.md", { lineOffset: 2, maxLines: 1 });
    assert.equal(read.content, "first");
    assert.equal(read.startLineNumber, 2);
    assert.equal(read.truncated, true);
    writeFileSync(path.join(root, ".hidden"), "x");
    const list = listMemoryFiles(root);
    assert.equal(list.entries.some((entry) => entry.path === ".hidden"), false);
    assert.equal(list.entries.some((entry) => entry.path === "rollout_summaries"), true);
  });
});

test("search matches literals and can require all queries", () => {
  withRoot((root) => {
    const any = searchMemoryFiles(root, { queries: ["needle"] });
    assert.equal(any.matches.length, 1);
    assert.equal(any.matches[0].path, "rollout_summaries/a.md");
    const all = searchMemoryFiles(root, { queries: ["needle", "missing"], matchMode: "all_on_same_line" });
    assert.equal(all.matches.length, 0);
  });
});

test("addAdHocNote validates the filename and refuses overwrite", () => {
  withRoot((root) => {
    const result = addAdHocNote(root, { filename: "2026-11-11T12-00-00-pref.md", note: "remember this" });
    assert.equal(result.path, "extensions/ad_hoc/notes/2026-11-11T12-00-00-pref.md");
    assert.throws(() => addAdHocNote(root, { filename: "2026-11-11T12-00-00-pref.md", note: "again" }), /already exists/);
    assert.throws(() => addAdHocNote(root, { filename: "../bad.md", note: "x" }), /filename/);
  });
});

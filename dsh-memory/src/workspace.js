/**
 * File-backed memory artifacts and the workspace baseline that makes Phase 2
 * incremental.
 *
 * Codex uses a git-baseline repository under the memory root. DSH plugins are
 * expected to stay dependency-free, so this module keeps an equivalent
 * content-addressed baseline in `.dsh-memory-baseline.json` and renders a
 * bounded, git-style status/diff artifact before consolidation. The semantics
 * are the same: only changed inputs are presented as new evidence, deletions
 * are visible, and a successful consolidation advances the baseline.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { memoryPaths } from "./config.js";
export { memoryPaths } from "./config.js";

const BASELINE_VERSION = 1;

/** Resolve the paths owned by one memory root. */
export function pathsFor(root) {
  return memoryPaths(root);
}

/** Create the memory layout; reject a symlinked root. */
export function ensureLayout(root) {
  mkdirSync(root, { recursive: true });
  if (lstatSync(root).isSymbolicLink()) throw new Error(`memory root cannot be a symbolic link: ${root}`);
  const paths = memoryPaths(root);
  for (const dir of [paths.rolloutSummaries, paths.extensions, paths.adHocNotes]) {
    mkdirSync(dir, { recursive: true });
    if (lstatSync(dir).isSymbolicLink()) throw new Error(`memory directory cannot be a symbolic link: ${dir}`);
  }
  return paths;
}

/** Whether a file exists and is a regular file. */
export function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Reject a symlink at an artifact path. */
function rejectSymlink(file) {
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error(`memory artifact cannot be a symbolic link: ${file}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/** Read a UTF-8 file, or the fallback. */
export function readText(file, fallback = "") {
  try {
    rejectSymlink(file);
    return readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

/** Write a UTF-8 file, creating its parent. */
export function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  rejectSymlink(file);
  writeFileSync(file, text, "utf8");
}

/** SHA-256 of a file's bytes. */
export function hashFile(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Format unix seconds as a filesystem-safe UTC timestamp. */
export function formatTimestamp(seconds) {
  return new Date(seconds * 1000).toISOString().replace(/[:.]/g, "-").replace("Z", "").slice(0, 19);
}

/** Short deterministic base62 hash of a thread id. */
export function shortHash(threadId) {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let hash = 0;
  for (const byte of Buffer.from(String(threadId), "utf8")) hash = (hash * 31 + byte) >>> 0;
  let value = hash % 14_776_336;
  let out = "";
  for (let index = 0; index < 4; index += 1) {
    out = alphabet[value % alphabet.length] + out;
    value = Math.floor(value / alphabet.length);
  }
  return out;
}

/** Sanitize a model-supplied slug to Codex's 60-character filesystem form. */
export function sanitizeSlug(slug) {
  if (typeof slug !== "string") return "";
  let out = "";
  for (const ch of slug) {
    if (out.length >= 60) break;
    out += /[A-Za-z0-9]/.test(ch) ? ch.toLowerCase() : "_";
  }
  return out.replace(/_+$/, "");
}

/** Deterministic rollout summary filename for one output. */
export function summaryFileName(output) {
  const prefix = `${formatTimestamp(output.sourceUpdatedAt)}-${shortHash(output.threadId)}`;
  const slug = sanitizeSlug(output.rolloutSlug);
  return `${prefix}${slug ? `-${slug}` : ""}.md`;
}

/** Render one rollout summary file, including provenance headers. */
export function summaryFileContent(output, fileName) {
  const lines = [
    `thread_id: ${output.threadId}`,
    `updated_at: ${new Date(output.sourceUpdatedAt * 1000).toISOString()}`,
    `rollout_path: ${output.rolloutPath ?? "unknown"}`,
    `cwd: ${output.cwd ?? "unknown"}`,
  ];
  if (output.gitBranch) lines.push(`git_branch: ${output.gitBranch}`);
  lines.push("", String(output.rolloutSummary ?? "").trimEnd(), "");
  return lines.join("\n");
}

/** Write one selected output and return its relative filename. */
export function writeSummaryFile(root, output) {
  const paths = ensureLayout(root);
  const fileName = output.summaryFile || summaryFileName(output);
  if (fileName !== path.basename(fileName) || fileName.startsWith(".")) throw new Error(`invalid rollout summary filename: ${fileName}`);
  writeText(path.join(paths.rolloutSummaries, fileName), summaryFileContent(output, fileName));
  return fileName;
}

/** List rollout summary files as relative names. */
export function listSummaryFiles(root) {
  const dir = memoryPaths(root).rolloutSummaries;
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

/**
 * Sync the selected outputs to `rollout_summaries/`.
 * Stale summaries are deleted, matching Codex's selection-as-baseline behavior.
 *
 * @returns the selected outputs with their resolved summary filenames.
 */
export function syncSummaries(root, selected) {
  const keep = new Set();
  const resolved = [];
  for (const output of selected) {
    const fileName = writeSummaryFile(root, output);
    keep.add(fileName);
    resolved.push({ ...output, summaryFile: fileName });
  }
  for (const name of listSummaryFiles(root)) {
    if (!keep.has(name)) {
      try {
        rmSync(path.join(memoryPaths(root).rolloutSummaries, name));
      } catch {}
    }
  }
  return resolved;
}

/** Whether a summary has the required v2 shape. */
export function validateSummary(summary, maxBytes = 10_000) {
  if (typeof summary !== "string") return { ok: false, reason: "summary is not a string" };
  const bytes = Buffer.byteLength(summary, "utf8");
  if (bytes >= maxBytes) return { ok: false, reason: `summary is ${bytes} bytes (must be under ${maxBytes})` };
  const lines = summary.split("\n");
  if (lines[0] !== "v1") return { ok: false, reason: 'first line must be exactly "v1"' };
  for (const heading of ["## User Profile", "## User preferences", "## General Tips", "## What's in Memory"]) {
    if (!lines.some((line) => line.trim() === heading)) return { ok: false, reason: `missing heading: ${heading}` };
  }
  return { ok: true, bytes };
}

/** Read and validate the current memory summary. */
export function readSummary(root, maxBytes = 10_000) {
  const summary = readText(memoryPaths(root).summary, "");
  if (summary.trim() === "") return { summary: "", valid: false, bytes: 0 };
  const check = validateSummary(summary, maxBytes);
  return { summary, valid: check.ok, bytes: Buffer.byteLength(summary, "utf8"), reason: check.reason };
}

/** Write the memory summary atomically enough for a plugin (temp + rename). */
export function writeSummary(root, summary) {
  const file = memoryPaths(root).summary;
  const temp = `${file}.${process.pid}.tmp`;
  writeText(temp, summary.endsWith("\n") ? summary : `${summary}\n`);
  try {
    renameSync(temp, file);
  } catch {
    writeText(file, summary);
    rmSync(temp, { force: true });
  }
}

/** List ad hoc notes with relative names and content. */
export function listAdHocNotes(root) {
  const dir = memoryPaths(root).adHocNotes;
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => ({ name, path: path.join(dir, name), content: readText(path.join(dir, name)) }));
  } catch {
    return [];
  }
}

/** Whether a file is in the memory subtree and not a symlink. */
export function insideRoot(root, candidate) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  try {
    return !lstatSync(resolved).isSymbolicLink();
  } catch {
    return true;
  }
}

/** List every artifact that participates in the baseline. */
export function listArtifactFiles(root) {
  const paths = memoryPaths(root);
  const files = [];
  const visit = (dir, prefix = "") => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === path.basename(paths.baseline) || entry.name.endsWith(".tmp")) continue;
      const full = path.join(dir, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      let metadata;
      try {
        metadata = lstatSync(full);
      } catch {
        continue;
      }
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) visit(full, relative);
      else if (metadata.isFile()) files.push(relative);
    }
  };
  visit(paths.root);
  return files.sort();
}

/** Read the baseline manifest. */
export function readBaseline(root) {
  const file = memoryPaths(root).baseline;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== BASELINE_VERSION || typeof parsed.files !== "object" || parsed.files === null) return { version: BASELINE_VERSION, files: {} };
    return parsed;
  } catch {
    return { version: BASELINE_VERSION, files: {} };
  }
}

/** Build a manifest of current artifact hashes. */
export function currentManifest(root) {
  const files = {};
  for (const relative of listArtifactFiles(root)) files[relative] = hashFile(path.join(root, relative));
  return { version: BASELINE_VERSION, files };
}

/** Compare two manifests. */
export function diffManifests(before, after) {
  const added = [];
  const modified = [];
  const deleted = [];
  const beforeFiles = before?.files ?? {};
  const afterFiles = after?.files ?? {};
  for (const [file, hash] of Object.entries(afterFiles)) {
    if (!(file in beforeFiles)) added.push(file);
    else if (beforeFiles[file] !== hash) modified.push(file);
  }
  for (const file of Object.keys(beforeFiles)) if (!(file in afterFiles)) deleted.push(file);
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort(), hasChanges: added.length + modified.length + deleted.length > 0 };
}

/** One small line-based unified diff; falls back to a change notice for huge files. */
export function unifiedDiff(relative, beforeText, afterText, maxBytes = 200_000) {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  if (before.length * after.length > 4_000_000) return `[diff omitted: ${relative} is too large]\n`;
  const rows = before.length + 1;
  const cols = after.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      lcs[i][j] = before[i - 1] === after[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }
  const lines = [];
  let i = before.length;
  let j = after.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      lines.push(`+${after[j - 1]}`);
      j -= 1;
    } else {
      lines.push(`-${before[i - 1]}`);
      i -= 1;
    }
  }
  lines.reverse();
  const body = `--- a/${relative}\n+++ b/${relative}\n` + lines.map((line) => line + "\n").join("");
  if (Buffer.byteLength(body, "utf8") > maxBytes) return `[diff omitted: ${relative} exceeds ${maxBytes} bytes]\n`;
  return body;
}

/**
 * Write `phase2_workspace_diff.md` from the current baseline comparison.
 * @returns `{ diff, rendered, text }`.
 */
export function writeWorkspaceDiff(root, before, after) {
  const diff = diffManifests(before, after);
  const sections = [
    "# Memory Workspace Diff",
    "",
    "Generated by dsh-memory before Phase 2 consolidation. Read this file first and do not edit it.",
    "",
    "## Status",
  ];
  if (!diff.hasChanges) {
    sections.push("- none");
  } else {
    for (const file of diff.added) sections.push(`- A ${file}`);
    for (const file of diff.modified) sections.push(`- M ${file}`);
    for (const file of diff.deleted) sections.push(`- D ${file}`);
  }
  sections.push("", "## Diff", "", "\`\`\`diff");
  const chunks = [];
  for (const file of diff.added) {
    const full = path.join(root, file);
    if (!isFile(full)) continue;
    chunks.push(unifiedDiff(file, "", readText(full)));
  }
  for (const file of diff.modified) {
    chunks.push(`--- a/${file}\n+++ b/${file}\n[modified: the current workspace content is the authority]\n`);
  }
  const rendered = sections.join("\n") + "\n" + chunks.join("\n") + "\n\`\`\`\n";
  const text = rendered.length > 4 * 1024 * 1024 ? rendered.slice(0, 4 * 1024 * 1024) + "\n[workspace diff truncated]\n" : rendered;
  writeText(memoryPaths(root).workspaceDiff, text);
  return { diff, text };
}

/** Advance the baseline to the given manifest, excluding the generated diff file. */
export function commitBaseline(root, manifest) {
  const files = { ...manifest.files };
  delete files[path.basename(memoryPaths(root).workspaceDiff)];
  const text = JSON.stringify({ version: BASELINE_VERSION, files }, null, 2) + "\n";
  writeText(memoryPaths(root).baseline, text);
}

/** Remove a file, ignoring absence. */
export function removeFile(file) {
  try {
    rmSync(file, { force: true });
  } catch {}
}

/** Whether a path exists. */
export function exists(file) {
  return existsSync(file);
}

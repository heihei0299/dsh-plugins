/**
 * Optional model-facing memory tools, enabled by `dedicatedTools`.
 *
 * The schemas mirror Codex's `memories` namespace tools (read/search/list/add
 * ad hoc note) while staying within DSH's flat tool naming. Path safety is
 * enforced here: only regular files under the memory root, no hidden or parent
 * segments, and no symlink traversal.
 */

import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { memoryPaths } from "./config.js";
import { truncateText } from "./transcript.js";

const MAX_READ_BYTES = 40_000;
const MAX_SEARCH_RESULTS = 200;
const MAX_LIST_RESULTS = 2_000;

/** Resolve a model-supplied relative path, rejecting escapes and symlinks. */
export function safePath(root, relative, options = {}) {
  if (typeof relative !== "string" || relative.trim() === "") throw new Error("path must be a non-empty relative path");
  const clean = relative.replaceAll("\\", "/");
  if (path.isAbsolute(clean)) throw new Error("path must be relative to the memory root");
  const parts = clean.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === ".." || part.startsWith("."))) throw new Error("path may not contain hidden or parent segments");
  const full = path.join(root, ...parts);
  const relativeCheck = path.relative(root, full);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) throw new Error("path escapes the memory root");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink()) throw new Error("symlink paths are not readable");
      if (part !== parts[parts.length - 1] && !metadata.isDirectory()) throw new Error("path traverses a non-directory");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (options.mustExist === true) throw new Error("path does not exist");
      break;
    }
  }
  return { full, relative: parts.join("/") };
}

/** Read one relative text file. */
export function readMemoryFile(root, relative, options = {}) {
  const { full, relative: clean } = safePath(root, relative, { mustExist: true });
  const metadata = statSync(full);
  if (!metadata.isFile()) throw new Error("path is not a file");
  const text = readFileSync(full, "utf8");
  const lines = text.split("\n");
  const lineOffset = Number.isSafeInteger(options.lineOffset) && options.lineOffset > 0 ? options.lineOffset : 1;
  const maxLines = Number.isSafeInteger(options.maxLines) && options.maxLines > 0 ? options.maxLines : lines.length;
  const start = lineOffset - 1;
  const selected = lines.slice(start, start + maxLines);
  const content = truncateText(selected.join("\n"), MAX_READ_BYTES);
  return {
    path: clean,
    startLineNumber: lineOffset,
    content,
    truncated: start + selected.length < lines.length || content !== selected.join("\n"),
  };
}

/** List entries under one directory. */
export function listMemoryFiles(root, relative = "") {
  const base = relative === "" ? root : safePath(root, relative).full;
  const metadata = statSync(base);
  if (!metadata.isDirectory()) throw new Error("path is not a directory");
  const entries = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(base, entry.name);
    try {
      if (lstatSync(full).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const childRelative = relative === "" ? entry.name : `${relative.replace(/\/$/, "")}/${entry.name}`;
    entries.push({ path: childRelative, entryType: entry.isDirectory() ? "directory" : "file" });
    if (entries.length >= MAX_LIST_RESULTS) break;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const result = { entries, truncated: entries.length >= MAX_LIST_RESULTS };
  if (relative !== "") result.path = relative;
  return result;
}

/** Search memory text for literal substrings. */
export function searchMemoryFiles(root, input) {
  const queries = Array.isArray(input.queries) ? input.queries.filter((query) => typeof query === "string" && query.length > 0) : [];
  if (queries.length === 0) throw new Error("queries must contain at least one non-empty string");
  const matchMode = input.matchMode === "all_on_same_line" || input.matchMode === "all_within_lines" ? input.matchMode : "any";
  const caseSensitive = input.caseSensitive !== false;
  const normalized = input.normalized === true;
  const maxResults = Number.isSafeInteger(input.maxResults) && input.maxResults > 0 ? Math.min(input.maxResults, MAX_SEARCH_RESULTS) : MAX_SEARCH_RESULTS;
  const contextLines = Number.isSafeInteger(input.contextLines) && input.contextLines > 0 ? Math.min(input.contextLines, 4) : 0;
  const startDir = typeof input.path === "string" && input.path.trim() !== "" ? safePath(root, input.path).full : root;
  const matches = [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || matches.length >= maxResults) continue;
      const full = path.join(dir, entry.name);
      try {
        if (lstatSync(full).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  if (statSync(startDir).isFile()) files.push(startDir);
  else walk(startDir);

  const normalise = (line) => (normalized ? line.replace(/[^A-Za-z0-9]+/g, "").toLowerCase() : caseSensitive ? line : line.toLowerCase());
  const needles = queries.map((query) => (normalized ? normalise(query) : caseSensitive ? query : query.toLowerCase()));
  if (needles.some((needle) => needle === "")) return { queries, matchMode, matches: [], truncated: false };
  for (const file of files.sort()) {
    if (matches.length >= maxResults) break;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
      const line = normalise(lines[index]);
      const hitQueries = queries.filter((_query, queryIndex) => line.includes(needles[queryIndex]));
      let matched = false;
      if (matchMode === "any") matched = hitQueries.length > 0;
      else if (matchMode === "all_on_same_line") matched = hitQueries.length === queries.length;
      else {
        const window = lines.slice(index, index + (Number.isSafeInteger(input.lineCount) && input.lineCount > 0 ? input.lineCount : 5)).map(normalise).join("\n");
        matched = queries.every((_query, queryIndex) => window.includes(needles[queryIndex]));
      }
      if (!matched) continue;
      const contextStart = Math.max(0, index - contextLines);
      const contextEnd = Math.min(lines.length, index + contextLines + 1);
      matches.push({
        path: path.relative(root, file).replaceAll(path.sep, "/"),
        matchLineNumber: index + 1,
        contentStartLineNumber: contextStart + 1,
        content: lines.slice(contextStart, contextEnd).join("\n"),
        matchedQueries: hitQueries,
      });
    }
  }
  const result = { queries, matchMode, matches, truncated: matches.length >= maxResults };
  if (typeof input.path === "string" && input.path.trim() !== "") result.path = input.path;
  return result;
}

/** Write one ad hoc note with Codex's filename shape. */
export function addAdHocNote(root, input) {
  const filename = typeof input.filename === "string" ? input.filename : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,79}\.md$/.test(filename)) {
    throw new Error("filename must match YYYY-MM-DDTHH-MM-SS-<slug>.md with a lowercase slug");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note === "") throw new Error("note must not be empty");
  const dir = memoryPaths(root).adHocNotes;
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, filename);
  try {
    writeFileSync(full, note.endsWith("\n") ? note : `${note}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`note already exists: ${filename}`);
    throw error;
  }
  return { path: `extensions/ad_hoc/notes/${filename}` };
}

/** Build one plain DSH tool definition. */
function tool(name, description, parameters, render, execute) {
  return {
    name,
    description,
    parameters: { type: "object", additionalProperties: false, ...parameters },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: render(value) }],
    },
    execute: async (args, exec) => {
      exec.signal.throwIfAborted();
      return execute(args ?? {}, exec);
    },
    isConcurrencySafe: () => true,
  };
}

/**
 * Build the optional tool definitions.
 * @param {object} options - root, engine, config, logger.
 * @returns tool definitions ready for `ctx.tools.register`.
 */
export function memoryTools({ root, engine }) {
  return [
    tool(
      "memory_read",
      "Read a memory artifact by relative path, optionally starting at a 1-indexed line offset and limiting the number of lines returned.",
      {
        properties: {
          path: { type: "string", description: "Path relative to the memory root, such as memory_summary.md or rollout_summaries/<file>.md." },
          line_offset: { type: "integer", minimum: 1, description: "1-indexed first line." },
          max_lines: { type: "integer", minimum: 1, description: "Maximum number of lines to return." },
        },
        required: ["path"],
      },
      (value) => `${value.path}:${value.startLineNumber}\n${value.content}${value.truncated ? "\n[truncated]" : ""}`,
      (args) => {
        const value = readMemoryFile(root, args.path, { lineOffset: args.line_offset, maxLines: args.max_lines });
        engine.noteUsage(value.path);
        return value;
      },
    ),
    tool(
      "memory_search",
      "Search memory artifacts for literal substrings, optionally requiring all queries on one line or within a line window.",
      {
        properties: {
          queries: { type: "array", minItems: 1, items: { type: "string" }, description: "Literal substrings to search for." },
          match_mode: { type: "string", enum: ["any", "all_on_same_line", "all_within_lines"], description: "How multiple queries must co-occur." },
          path: { type: "string", description: "Optional relative directory or file to limit the search." },
          context_lines: { type: "integer", minimum: 0, description: "Lines of context around each hit." },
          case_sensitive: { type: "boolean", description: "Defaults to true." },
          normalized: { type: "boolean", description: "Ignore non-alphanumeric separators and case." },
          line_count: { type: "integer", minimum: 1, description: "Window size for all_within_lines (default 5)." },
          max_results: { type: "integer", minimum: 1, description: "Maximum hits (default 200)." },
        },
        required: ["queries"],
      },
      (value) => value.matches.length === 0
        ? "No memory matches."
        : value.matches.map((match) => `${match.path}:${match.matchLineNumber}\n${match.content}`).join("\n\n") + (value.truncated ? "\n[truncated]" : ""),
      (args) => {
        const value = searchMemoryFiles(root, {
          queries: args.queries,
          matchMode: args.match_mode,
          path: args.path,
          contextLines: args.context_lines,
          caseSensitive: args.case_sensitive,
          normalized: args.normalized,
          lineCount: args.line_count,
          maxResults: args.max_results,
        });
        for (const match of value.matches) engine.noteUsage(match.path);
        return value;
      },
    ),
    tool(
      "memory_list",
      "List memory artifacts and directories under the memory root.",
      {
        properties: { path: { type: "string", description: "Optional relative directory." } },
      },
      (value) => value.entries.map((entry) => `${entry.path}${entry.entryType === "directory" ? "/" : ""}`).join("\n") || "Empty directory.",
      (args) => listMemoryFiles(root, typeof args.path === "string" ? args.path : ""),
    ),
    tool(
      "memory_note",
      "Record a user-requested memory addition, correction, or deletion note. Use only when the user explicitly asks to remember, forget, or correct something.",
      {
        properties: {
          filename: { type: "string", description: "YYYY-MM-DDTHH-MM-SS-<slug>.md, lowercase." },
          note: { type: "string", description: "The exact requested addition, deletion, or correction." },
        },
        required: ["filename", "note"],
      },
      (value) => `Recorded ${value.path}. Consolidation applies it later.`,
      (args) => addAdHocNote(root, args),
    ),
  ];
}

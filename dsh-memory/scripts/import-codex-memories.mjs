#!/usr/bin/env node
/**
 * Import a Codex v2 memory workspace into a dsh-memory root.
 *
 * Codex keeps its workspace under <codex-home>/memories_v2 and its state in
 * <codex-home>/memories_v2_1.sqlite. dsh-memory keeps both under
 * <dsh-home>/memories_v2 (the DB is inside the workspace root). A plain copy
 * is not enough: dsh-memory's startup prune treats every stage-1 row without a
 * matching DSH session as deleted. This importer therefore:
 *
 * - copies the workspace artifacts (summary, rollout summaries, extensions,
 *   skills) without the git baseline or generated diff;
 * - imports stage-1 rows with origin='codex' so the plugin can skip them in
 *   session-existence pruning;
 * - fills summary_file/cwd/rollout_path/git_branch from the summary headers;
 * - writes a baseline so the first Phase 2 sees a clean workspace.
 *
 * The default is a dry run. Pass --apply to write.
 */

import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DB_FILENAME } from "../src/config.js";
import { MemoryStore } from "../src/store.js";
import {
  commitBaseline,
  currentManifest,
  readSummary,
  validateSummary,
} from "../src/workspace.js";

const HEADER_KEYS = new Set(["thread_id", "updated_at", "rollout_path", "cwd", "git_branch"]);
const EXCLUDED_NAMES = new Set([
  ".git",
  "phase2_workspace_diff.md",
  ".dsh-memory-baseline.json",
  DB_FILENAME,
]);
const LEGACY_NAMES = new Set(["raw_memories.md", "MEMORY.md"]);

/** Parse the provenance header Codex writes above each rollout summary. */
export function parseSummaryHeader(text) {
  const lines = String(text).split("\n");
  const header = {};
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") break;
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match || !HEADER_KEYS.has(match[1])) break;
    header[match[1]] = match[2].trim();
  }
  const bodyStart = index < lines.length && lines[index].trim() === "" ? index + 1 : index;
  return { ...header, body: lines.slice(bodyStart).join("\n").trimEnd() };
}

/** Read one UTF-8 file. */
function readText(file) {
  return readFileSync(file, "utf8");
}

/** Index rollout summaries by the thread id in their header. */
export function indexSummaryFiles(root) {
  const directory = path.join(root, "rollout_summaries");
  const files = [];
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    let text;
    try {
      text = readText(full);
    } catch {
      continue;
    }
    const header = parseSummaryHeader(text);
    if (typeof header.thread_id !== "string" || header.thread_id === "") continue;
    files.push({ name: entry.name, path: full, header, body: header.body });
  }
  return files;
}

/** Copy memory artifacts, excluding generated and baseline files. */
export function copyWorkspace(sourceRoot, destRoot, options = {}) {
  const keepLegacy = options.keepLegacy === true;
  const warnings = [];
  const copyEntry = (source, dest, relative) => {
    let metadata;
    try {
      metadata = lstatSync(source);
    } catch {
      return;
    }
    if (metadata.isSymbolicLink()) {
      warnings.push(`skipped symlink: ${relative}`);
      return;
    }
    if (metadata.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (EXCLUDED_NAMES.has(entry.name) || (!keepLegacy && LEGACY_NAMES.has(entry.name)) || entry.name.endsWith(".tmp")) continue;
        copyEntry(path.join(source, entry.name), path.join(dest, entry.name), relative === "" ? entry.name : `${relative}/${entry.name}`);
      }
      return;
    }
    if (metadata.isFile()) cpSync(source, dest, { force: false, errorOnExist: true });
  };
  mkdirSync(destRoot, { recursive: true });
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name) || (!keepLegacy && LEGACY_NAMES.has(entry.name)) || entry.name.endsWith(".tmp")) continue;
    copyEntry(path.join(sourceRoot, entry.name), path.join(destRoot, entry.name), entry.name);
  }
  return warnings;
}

/** Read all stage-1 rows from a Codex memories DB. */
export function readSourceRows(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`Codex memories database not found: ${dbPath}`);
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    throw new Error(`cannot open Codex memories database (checkpoint/stop Codex first): ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'stage1_outputs'").get();
    if (table === undefined) throw new Error(`not a memories_v2 database (missing stage1_outputs): ${dbPath}`);
    return db.prepare("SELECT * FROM stage1_outputs").all();
  } finally {
    db.close();
  }
}

/** Parse rollout_summaries pointers from a v2 summary. */
export function summaryPointers(summary) {
  const pointers = new Set();
  for (const match of String(summary).matchAll(/rollout_summaries\/[A-Za-z0-9._-]+\.md/g)) pointers.add(match[0]);
  return [...pointers];
}

/** Convert a header timestamp to unix seconds. */
function headerSeconds(value, fallback) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

/** Build an import plan without touching the destination. */
export function planImport(options = {}) {
  const codexHome = path.resolve(options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
  const dshHome = path.resolve(options.dshHome ?? process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"));
  const sourceRoot = path.resolve(options.sourceRoot ?? path.join(codexHome, "memories_v2"));
  const destRoot = path.resolve(options.destRoot ?? path.join(dshHome, "memories_v2"));
  const sourceDb = path.resolve(options.sourceDb ?? path.join(codexHome, "memories_v2_1.sqlite"));
  const destDb = path.join(destRoot, DB_FILENAME);
  const warnings = [];
  const errors = [];
  const skipped = [];
  const imports = [];

  if (sourceRoot === destRoot) errors.push("source and destination memory roots must differ");
  if (sourceDb === destDb) errors.push("source and destination databases must differ");
  if (!existsSync(sourceRoot)) errors.push(`Codex memory workspace not found: ${sourceRoot}`);

  let summaryText = "";
  const summaryPath = path.join(sourceRoot, "memory_summary.md");
  if (existsSync(summaryPath)) {
    summaryText = readText(summaryPath);
  } else {
    errors.push(`memory_summary.md not found in ${sourceRoot}`);
  }
  const summaryCheck = summaryText === "" ? { ok: false, reason: "missing" } : validateSummary(summaryText, 10_000);
  if (!summaryCheck.ok) errors.push(`memory_summary.md is not a valid v2 summary: ${summaryCheck.reason}`);

  let rows = [];
  try {
    rows = readSourceRows(sourceDb);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const files = existsSync(sourceRoot) ? indexSummaryFiles(sourceRoot) : [];
  const fileByThread = new Map();
  const fileByName = new Map();
  for (const file of files) {
    fileByName.set(file.name, file);
    if (fileByThread.has(file.header.thread_id)) {
      warnings.push(`duplicate summary header thread_id=${file.header.thread_id}: ${file.name}`);
      continue;
    }
    fileByThread.set(file.header.thread_id, file);
  }

  const now = Math.floor(Date.now() / 1000);
  const preserveUsage = options.preserveUsage === true;
  const seenThreads = new Set();

  for (const row of rows) {
    const threadId = String(row.thread_id ?? "");
    if (threadId === "") {
      skipped.push({ threadId: "", reason: "empty thread_id" });
      continue;
    }
    if (seenThreads.has(threadId)) {
      skipped.push({ threadId, reason: "duplicate thread_id in source database" });
      continue;
    }
    seenThreads.add(threadId);
    const file = (typeof row.summary_file === "string" && fileByName.get(row.summary_file)) || fileByThread.get(threadId);
    if (file === undefined) {
      const reason = "no rollout summary file with a matching thread_id";
      if (options.allowMissing === true) skipped.push({ threadId, reason });
      else errors.push(`${threadId}: ${reason}`);
      continue;
    }
    const dbBody = typeof row.rollout_summary === "string" ? row.rollout_summary.trimEnd() : "";
    const body = dbBody === "" ? file.body : dbBody;
    if (dbBody !== "" && file.body !== "" && dbBody !== file.body) {
      warnings.push(`${threadId}: database and ${file.name} summary bodies differ; database body wins`);
    }
    if (body.trim() === "") {
      skipped.push({ threadId, reason: "empty rollout summary" });
      continue;
    }
    if (typeof row.raw_memory === "string" && row.raw_memory.trim() !== "") {
      warnings.push(`${threadId}: v1 raw_memory ignored (v2 stores summaries only)`);
    }
    const sourceUpdatedAt = Number.isSafeInteger(Number(row.source_updated_at)) ? Number(row.source_updated_at) : headerSeconds(file.header.updated_at, now);
    imports.push({
      threadId,
      sourceUpdatedAt,
      rolloutSummary: body,
      rolloutSlug: typeof row.rollout_slug === "string" && row.rollout_slug.trim() !== "" ? row.rollout_slug : undefined,
      generatedAt: Number.isSafeInteger(Number(row.generated_at)) ? Number(row.generated_at) : now,
      usageCount: row.usage_count === null || row.usage_count === undefined ? null : Number(row.usage_count),
      lastUsage: preserveUsage && row.last_usage !== null && row.last_usage !== undefined ? Number(row.last_usage) : now,
      summaryFile: file.name,
      cwd: file.header.cwd ?? row.cwd ?? undefined,
      rolloutPath: file.header.rollout_path ?? row.rollout_path ?? undefined,
      gitBranch: file.header.git_branch ?? row.git_branch ?? undefined,
    });
  }

  // Adopt summary files that exist on disk but have no DB row. This keeps
  // pointers in memory_summary.md resolvable when the DB is incomplete.
  for (const file of files) {
    if (seenThreads.has(file.header.thread_id)) continue;
    seenThreads.add(file.header.thread_id);
    if (file.body.trim() === "") {
      skipped.push({ threadId: file.header.thread_id, reason: "orphan summary file has an empty body" });
      continue;
    }
    warnings.push(`adopted orphan summary file without a DB row: ${file.name}`);
    imports.push({
      threadId: file.header.thread_id,
      sourceUpdatedAt: headerSeconds(file.header.updated_at, now),
      rolloutSummary: file.body,
      rolloutSlug: undefined,
      generatedAt: now,
      usageCount: 0,
      lastUsage: now,
      summaryFile: file.name,
      cwd: file.header.cwd,
      rolloutPath: file.header.rollout_path,
      gitBranch: file.header.git_branch,
    });
  }

  const pointers = summaryText === "" ? [] : summaryPointers(summaryText);
  const missingPointers = pointers.filter((pointer) => !existsSync(path.join(sourceRoot, pointer)));
  for (const pointer of missingPointers) warnings.push(`memory_summary.md pointer is missing on disk: ${pointer}`);

  if (imports.length > 256) {
    warnings.push(`${imports.length} summaries imported; raise maxRawMemoriesForConsolidation above 256 before the first Phase 2 or the excess files will be pruned`);
  }

  return {
    codexHome,
    dshHome,
    sourceRoot,
    destRoot,
    sourceDb,
    destDb,
    rows: rows.length,
    files: files.length,
    imports,
    skipped,
    warnings,
    errors,
    summary: summaryCheck,
    pointers,
    missingPointers,
  };
}

/** Apply a plan to a new, empty destination memory root. */
export function applyImport(plan, options = {}) {
  if (plan.errors.length > 0) throw new Error(`refusing to import:\n- ${plan.errors.join("\n- ")}`);
  if (existsSync(plan.destRoot) && readdirSync(plan.destRoot).length > 0) {
    throw new Error(`destination is not empty: ${plan.destRoot}; move it away or choose another --dest-root`);
  }
  mkdirSync(plan.destRoot, { recursive: true });
  const copyWarnings = copyWorkspace(plan.sourceRoot, plan.destRoot, { keepLegacy: options.keepLegacy === true });

  const store = new MemoryStore(plan.destDb);
  store.close();

  const db = new DatabaseSync(plan.destDb);
  try {
    db.exec("BEGIN IMMEDIATE");
    const insert = db.prepare(`
      INSERT OR REPLACE INTO stage1_outputs (
        thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug,
        generated_at, usage_count, last_usage, selected_for_phase2,
        selected_for_phase2_source_updated_at, summary_file, cwd, rollout_path,
        git_branch, origin
      ) VALUES (?, ?, '', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'codex')
    `);
    for (const item of plan.imports) {
      insert.run(
        item.threadId,
        item.sourceUpdatedAt,
        item.rolloutSummary,
        item.rolloutSlug ?? null,
        item.generatedAt,
        item.usageCount,
        item.lastUsage,
        item.sourceUpdatedAt,
        item.summaryFile,
        item.cwd ?? null,
        item.rolloutPath ?? null,
        item.gitBranch ?? null,
      );
    }
    db.prepare("DELETE FROM jobs WHERE kind IN (?, ?)").run("memory_stage1", "memory_consolidate_global");
    db.prepare("UPDATE consolidation_progress SET max_thread_count = ?").run(plan.imports.length);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    db.close();
  }

  const manifest = currentManifest(plan.destRoot);
  commitBaseline(plan.destRoot, manifest);
  const summary = readSummary(plan.destRoot, 10_000);
  if (!summary.valid) throw new Error(`imported memory_summary.md is invalid: ${summary.reason}`);

  return {
    imported: plan.imports.length,
    skipped: plan.skipped.length,
    warnings: [...plan.warnings, ...copyWarnings],
    baselineFiles: Object.keys(manifest.files).length,
    summaryValid: summary.valid,
    destRoot: plan.destRoot,
    destDb: plan.destDb,
  };
}

/** Parse CLI arguments. */
function parseArgs(argv) {
  const options = { apply: false, strict: false, keepLegacy: false, preserveUsage: false, allowMissing: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--keep-legacy") options.keepLegacy = true;
    else if (arg === "--preserve-usage") options.preserveUsage = true;
    else if (arg === "--allow-missing") options.allowMissing = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--codex-home" || arg === "--dsh-home" || arg === "--source-root" || arg === "--dest-root" || arg === "--source-db") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Print a human-readable plan. */
function printPlan(plan) {
  console.log(`Codex workspace: ${plan.sourceRoot}`);
  console.log(`Codex database:  ${plan.sourceDb}`);
  console.log(`DSH destination: ${plan.destRoot}`);
  console.log(`rows=${plan.rows} summary_files=${plan.files} import=${plan.imports.length} skipped=${plan.skipped.length} pointers=${plan.pointers.length} missing_pointers=${plan.missingPointers.length}`);
  if (plan.skipped.length > 0) {
    for (const item of plan.skipped) console.log(`skip ${item.threadId || "<empty>"}: ${item.reason}`);
  }
  for (const warning of plan.warnings) console.log(`warn ${warning}`);
  for (const error of plan.errors) console.error(`error ${error}`);
}

/** CLI entry point. */
function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(`Usage: node dsh-memory/scripts/import-codex-memories.mjs [options]

  --codex-home <path>   Codex home (default: $CODEX_HOME or ~/.codex)
  --dsh-home <path>     DSH home (default: $DSH_HOME or ~/.dsh)
  --source-root <path>  Codex memories_v2 root
  --dest-root <path>    DSH memories_v2 root
  --source-db <path>    Codex memories_v2_1.sqlite
  --apply               Write the destination (default is a dry run)
  --strict              Treat warnings as failures
  --keep-legacy         Copy raw_memories.md / MEMORY.md if present
  --preserve-usage      Keep original last_usage instead of grandfathering rows
  --allow-missing       Skip DB rows with no matching summary file
  --json                Print JSON instead of the human summary
`);
    return 0;
  }
  const plan = planImport(options);
  if (options.json) console.log(JSON.stringify({ phase: "plan", ...plan }, null, 2));
  else printPlan(plan);
  if (plan.errors.length > 0) return 1;
  if (options.strict && plan.warnings.length > 0) return 1;
  if (!options.apply) {
    if (!options.json) console.log("Dry run only; pass --apply to write the destination.");
    return 0;
  }
  const result = applyImport(plan, options);
  if (options.json) console.log(JSON.stringify({ phase: "apply", ...result }, null, 2));
  else {
    console.log(`Imported ${result.imported} summaries; baseline has ${result.baselineFiles} files; summary_valid=${result.summaryValid}`);
    for (const warning of result.warnings) console.log(`warn ${warning}`);
    console.log("Next: start with generateMemories=false, verify injection/tools, then enable generation.");
  }
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

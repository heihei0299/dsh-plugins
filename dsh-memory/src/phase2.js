/**
 * Phase 2: global consolidation into `memory_summary.md`.
 *
 * Ported from Codex's v2 pipeline: claim the singleton job, sync the selected
 * rollout summaries, compare the workspace against the last successful
 * baseline, skip consolidation when nothing changed and the summary is still
 * valid, otherwise present the changed evidence to the consolidation model and
 * commit the new baseline only after a valid summary lands.
 */

import {
  commitBaseline,
  currentManifest,
  diffManifests,
  ensureLayout,
  listAdHocNotes,
  memoryPaths,
  readBaseline,
  readSummary,
  readText,
  removeFile,
  syncSummaries,
  validateSummary,
  writeSummary,
  writeWorkspaceDiff,
} from "./workspace.js";
import { completeText, parseConsolidationOutput } from "./llm.js";
import { CONSOLIDATION_SYSTEM, consolidationInput } from "./prompts.js";
import { truncateText } from "./transcript.js";

const HEARTBEAT_MS = 90_000;
const SUMMARY_PROMPT_BYTES = 20_000;

/** A minimal valid summary used when no evidence remains. */
export function minimalSummary() {
  return [
    "v1",
    "",
    "## User Profile",
    "No profile recorded yet.",
    "",
    "## User preferences",
    "No preferences recorded yet.",
    "",
    "## General Tips",
    "No general tips recorded yet.",
    "",
    "## What's in Memory",
    "No memories recorded yet.",
    "",
  ].join("\n");
}

/** Whether one relative path is a changed summary in the manifest diff. */
function isChangedSummary(file, diff) {
  return file.startsWith("rollout_summaries/") && (diff.added.includes(file) || diff.modified.includes(file));
}

/** The status part of the generated diff, bounded for a direct model call. */
function diffStatusForPrompt(root) {
  const text = readText(memoryPaths(root).workspaceDiff, "");
  if (text === "") return "- none";
  const marker = "\n## Diff";
  const status = text.includes(marker) ? text.slice(0, text.indexOf(marker)) : text;
  return truncateText(status.trim(), SUMMARY_PROMPT_BYTES);
}

/**
 * Build the consolidation prompt within a byte budget.
 * Notes are user-authored and go first; changed summaries follow in selection order.
 */
export function buildConsolidationPrompt({ root, existingSummary, resolved, diff, notes, maxBytes }) {
  const includeAll = existingSummary.trim() === "" || Object.keys(readBaseline(root).files).length === 0;
  const changed = includeAll
    ? resolved
    : resolved.filter((output) => isChangedSummary(`rollout_summaries/${output.summaryFile}`, diff));
  const deleted = diff.deleted.filter((file) => file.startsWith("rollout_summaries/"));
  const changedNotes = notes.filter((note) => diff.added.includes(`extensions/ad_hoc/notes/${note.name}`) || diff.modified.includes(`extensions/ad_hoc/notes/${note.name}`));

  const noteBlocks = [];
  for (const note of changedNotes) {
    noteBlocks.push(`### extensions/ad_hoc/notes/${note.name}\n\n${note.content.trim()}\n`);
  }
  const summaryBlocks = [];
  if (resolved.length > 0) {
    summaryBlocks.push([
      "### Selected summary index",
      "",
      ...resolved.map((output) => `- rollout_summaries/${output.summaryFile}; thread_id=${output.threadId}`),
      "",
    ].join("\n"));
  }
  for (const output of changed) {
    const file = `rollout_summaries/${output.summaryFile}`;
    summaryBlocks.push(`### ${file}\n\n${readText(`${memoryPaths(root).rolloutSummaries}/${output.summaryFile}`, "").trim()}\n`);
  }
  if (deleted.length > 0) summaryBlocks.push(`### Deleted summaries\n\n${deleted.map((file) => `- ${file}`).join("\n")}\n`);
  if (summaryBlocks.length === 0) summaryBlocks.push("No changed rollout summaries. Preserve the existing supported context.");

  let notesText = noteBlocks.join("\n");
  let summariesText = summaryBlocks.join("\n");
  const overhead = Buffer.byteLength(existingSummary, "utf8") + 8_000;
  let remaining = Math.max(4_000, (maxBytes ?? 240_000) - overhead);
  if (Buffer.byteLength(notesText, "utf8") > Math.floor(remaining / 3)) notesText = truncateText(notesText, Math.floor(remaining / 3));
  remaining -= Buffer.byteLength(notesText, "utf8");
  if (Buffer.byteLength(summariesText, "utf8") > remaining) summariesText = truncateText(summariesText, Math.max(1_000, remaining));

  return consolidationInput({
    memory_root: root,
    workspace_diff: diffStatusForPrompt(root),
    existing_summary: existingSummary.trim() === "" ? "(none)" : existingSummary,
    rollout_summaries: summariesText,
    ad_hoc_notes: notesText.trim() === "" ? "(none)" : notesText,
  });
}

/**
 * Run one global consolidation attempt.
 *
 * @returns `{ status, reason?, selected? }`; status is `succeeded`,
 *   `no-changes`, or a claim/failure reason.
 */
export async function runPhase2(options) {
  const { store, llm, config, route, workerId, signal, logger } = options;
  ensureLayout(config.root);
  const root = config.root;
  // A stale generated diff must never become memory input.
  removeFile(memoryPaths(root).workspaceDiff);
  const claim = store.claimPhase2(workerId ?? "dsh-memory", {
    leaseSeconds: config.jobLeaseSeconds,
    cooldownSeconds: config.phase2CooldownSeconds,
  });
  if (!claim.claimed) return { status: claim.reason ?? "skipped" };
  const selected = store.getPhase2InputSelection(config.maxRawMemoriesForConsolidation, config.maxUnusedDays);
  const heartbeat = setInterval(() => {
    try {
      store.heartbeatPhase2(claim.token, config.jobLeaseSeconds);
    } catch {}
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    const resolved = syncSummaries(root, selected);
    for (const output of resolved) {
      if (output.summaryFile !== undefined) store.setSummaryFile(output.threadId, output.summaryFile);
    }
    const baseline = readBaseline(root);
    const manifest = currentManifest(root);
    const diff = diffManifests(baseline, manifest);
    const existing = readSummary(root, config.summaryMaxBytes);
    const watermark = selected.reduce((max, output) => Math.max(max, output.sourceUpdatedAt), Number(claim.watermark ?? 0));

    if (!diff.hasChanges && existing.valid) {
      removeFile(memoryPaths(root).workspaceDiff);
      store.markPhase2Succeeded(claim.token, watermark, selected);
      return { status: "no-changes", selected: selected.length };
    }
    if (selected.length === 0 && existing.summary.trim() === "") {
      writeSummary(root, minimalSummary());
      commitBaseline(root, currentManifest(root));
      removeFile(memoryPaths(root).workspaceDiff);
      store.markPhase2Succeeded(claim.token, watermark, selected);
      return { status: "succeeded", selected: 0, minimal: true };
    }
    if (route?.provider === undefined || route?.model === undefined) {
      throw new Error("the triggering agent has no model route");
    }

    writeWorkspaceDiff(root, baseline, manifest);
    const notes = listAdHocNotes(root);
    const prompt = buildConsolidationPrompt({
      root,
      existingSummary: existing.summary,
      resolved,
      diff,
      notes,
      maxBytes: config.maxConsolidationBytes,
    });
    const output = await completeText(llm, {
      provider: route.provider,
      model: config.consolidationModel ?? route.model,
      system: CONSOLIDATION_SYSTEM,
      prompt,
      reasoningEffort: config.consolidationReasoningEffort,
      signal,
      purpose: "memory_consolidate",
    });
    const summary = parseConsolidationOutput(output);
    const check = validateSummary(summary, config.summaryMaxBytes);
    if (!check.ok) throw new Error(`invalid consolidated summary: ${check.reason}`);
    writeSummary(root, summary);
    commitBaseline(root, currentManifest(root));
    removeFile(memoryPaths(root).workspaceDiff);
    store.markPhase2Succeeded(claim.token, watermark, selected);
    return { status: "succeeded", selected: selected.length, bytes: check.bytes };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (signal?.aborted) {
      removeFile(memoryPaths(root).workspaceDiff);
      return { status: "aborted", reason };
    }
    try {
      store.markPhase2Failed(claim.token, reason, config.retryDelaySeconds);
    } catch {}
    removeFile(memoryPaths(root).workspaceDiff);
    logger?.warn?.(`dsh-memory: phase 2 failed: ${reason}`);
    return { status: "failed", reason };
  } finally {
    clearInterval(heartbeat);
  }
}

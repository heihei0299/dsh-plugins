/**
 * Read-path prompt assembly: inject `memory_summary.md` plus Codex's v2 memory
 * instructions into every session that has memories enabled.
 *
 * Codex truncates the injected summary to 2,500 tokens; the summary schema
 * already caps the file below 10,000 UTF-8 bytes, so this cap is a safety net.
 */

import { readPath } from "./prompts.js";
import { truncateText } from "./transcript.js";

const SUMMARY_PROMPT_BYTES = 10_000;

/**
 * Render the memory developer instructions.
 * @returns the section text, or `""` when no compatible summary exists.
 */
export function memorySectionText(engine, config) {
  if (!config.enabled || !config.useMemories) return "";
  const summary = engine.readSummaryForPrompt();
  if (summary === undefined || summary.trim() === "") return "";
  const bounded = truncateText(summary.trim(), Math.min(config.summaryMaxBytes, SUMMARY_PROMPT_BYTES));
  return readPath({ base_path: config.root, memory_summary: bounded });
}

/** Place memory instructions after file-reference guidance and before tool sections. */
export function memorySectionOrder(systemPrompt) {
  try {
    const base = systemPrompt?.getSectionOrder?.("FILE_REFERENCE");
    if (Number.isFinite(base)) return base + 10;
  } catch {}
  return 910;
}

/** Build the section object consumed by `ctx.systemPrompt.section`. */
export function memorySection(engine, config, systemPrompt) {
  return {
    name: "@local/dsh-memory:read-path",
    order: memorySectionOrder(systemPrompt),
    interpolate: false,
    text: () => {
      try {
        return memorySectionText(engine, config);
      } catch {
        return "";
      }
    },
  };
}

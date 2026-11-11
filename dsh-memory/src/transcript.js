/**
 * Render a DSH session transcript into the bounded, provenance-tiered evidence
 * that Codex's v2 stage-1 extractor expects.
 *
 * DSH has no `response_item` JSONL in the exact Codex shape, so this module
 * maps committed Session events onto equivalent tiers. The tier order and
 * newest-first selection are ported from
 * `codex-rs/memories/write/src/rollout_input.rs`: human, final, other agent,
 * commentary, harness context, tool. Rows are rendered back in source order
 * with a single omitted-evidence marker between gaps.
 */

import { redactSecrets } from "./redact.js";

const OMITTED = "[... evidence omitted ...]\n";
const TRUNCATION_RESERVE_BYTES = 96;
const TOOL_OUTPUT_TOKENS = 2_000;

/** Approximate bytes for a token count, matching Codex's estimator. */
export function approxBytesForTokens(tokens) {
  return Math.max(1, Math.floor(tokens * 4));
}

/** UTF-8 byte length. */
export function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Truncate a string to a UTF-8 byte budget without splitting a code point.
 * @param text - input text.
 * @param maxBytes - positive byte budget.
 * @returns the prefix, optionally marked as truncated.
 */
export function truncateText(text, maxBytes) {
  if (typeof text !== "string") return "";
  if (maxBytes <= 0) return "";
  if (byteLength(text) <= maxBytes) return text;
  const marker = "\n[... truncated ...]";
  const markerBytes = byteLength(marker);
  if (maxBytes <= markerBytes) return marker.slice(0, maxBytes);
  const budget = maxBytes - markerBytes;
  let end = Math.min(text.length, budget);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > budget) end -= 1;
  return text.slice(0, end) + marker;
}

/** Content-block text, replacing media with placeholders. */
function blockText(block) {
  if (block === null || typeof block !== "object") return "";
  switch (block.type) {
    case "text":
      return typeof block.text === "string" ? block.text : "";
    case "image":
    case "input_image":
      return "[image omitted]";
    case "audio":
    case "input_audio":
      return "[audio omitted]";
    default:
      return "";
  }
}

/** Joined text of a message content array. */
function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content.map(blockText).filter((part) => part.length > 0).join("\n");
}

/** Whether text is a marked harness fragment. */
function marked(text, open, close) {
  const trimmed = text.trimStart();
  if (!trimmed.toLowerCase().startsWith(open.toLowerCase())) return false;
  return trimmed.trimEnd().toLowerCase().endsWith(close.toLowerCase());
}

/** Classify one message source into a tier. */
function tierOfUserMessage(data, text) {
  const kind = data?.source?.kind;
  if (kind === "agent-instruction" || kind === "skill") return null;
  if (marked(text, "# AGENTS.md instructions", "</INSTRUCTIONS>")) return null;
  if (text.trimStart().toLowerCase().startsWith("<skill")) return null;
  if (marked(text, "<available_skills>", "</available_skills>") || marked(text, "<skill_content", "</skill_content>")) return null;
  if (kind === "subagent" || text.trimStart().toLowerCase().startsWith("<subagent_notification>")) return "other";
  if (kind === "runtime-context" || kind === "time-context" || kind === "compaction") return "context";
  if (marked(text, "<system-reminder>", "</system-reminder>")) {
    if (text.includes("<available_skills>") || text.includes("<skill_content")) return null;
    if (text.includes("# AGENTS.md instructions") || text.includes("Instructions from:") || text.includes("AGENTS.local.md")) return null;
    return "context";
  }
  if (kind === "user" || kind === undefined) {
    if (data?.role === "user" && Array.isArray(data?.content)) return "human";
    return "human";
  }
  return "context";
}

/** Build one row for a typed event, or undefined when it is not memory evidence. */
function rowOf(event, seenCalls = new Set()) {
  const data = event?.data;
  if (data === null || typeof data !== "object") return undefined;

  switch (event.type) {
    case "user/message": {
      const text = contentText(data.content);
      if (text.trim() === "") return undefined;
      const tier = tierOfUserMessage(data, text);
      if (tier === null) return undefined;
      const label = tier === "human" ? "human user" : tier === "other" ? "other agent" : "harness context";
      return { tier, label, value: { role: "user", text } };
    }
    case "developer/message": {
      const text = contentText(data.message?.content);
      if (text.trim() === "") return undefined;
      return { tier: "context", label: "developer", value: { role: "developer", text } };
    }
    case "assistant/message": {
      const content = data.message?.content;
      if (!Array.isArray(content)) return undefined;
      const texts = content.filter((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim() !== "");
      const calls = content.filter((block) => block?.type === "tool-call");
      const rows = [];
      if (texts.length > 0) {
        const text = texts.map((block) => block.text).join("\n");
        const tier = calls.length > 0 ? "commentary" : "final";
        rows.push({ tier, label: tier === "final" ? "assistant final" : "assistant commentary", value: { role: "assistant", text } });
      }
      for (const call of calls) {
        if (typeof call.id === "string") seenCalls.add(call.id);
        rows.push({
          tier: "tool",
          label: "tool",
          value: { role: "assistant", tool: call.name, arguments: call.arguments },
        });
      }
      return rows;
    }
    case "tool/call": {
      if (typeof data.callId === "string" && seenCalls.has(data.callId)) return undefined;
      if (typeof data.callId === "string") seenCalls.add(data.callId);
      return {
        tier: "tool",
        label: "tool",
        value: { role: "assistant", tool: data.name, arguments: data.arguments },
      };
    }
    case "tool/result": {
      const text = contentText(data.message?.content);
      if (text.trim() === "") return undefined;
      const toolCallId = data.message?.toolCallId;
      return {
        tier: "tool",
        label: "tool",
        value: { role: "tool", toolCallId, isError: data.message?.isError === true, text },
      };
    }
    default:
      return undefined;
  }
}

const TIER_ORDER = ["human", "final", "other", "commentary", "context", "tool"];

/**
 * Render memory evidence from committed Session events.
 *
 * @param events - Session events in log order.
 * @param options - `{ maxInputBytes, maxRowBytes }` bounds.
 * @returns the rendered evidence, or an empty string when nothing qualifies.
 */
export function renderTranscript(events, options = {}) {
  const maxInputBytes = Number.isSafeInteger(options.maxInputBytes) && options.maxInputBytes > 0 ? options.maxInputBytes : 400_000;
  const maxRowBytes = Number.isSafeInteger(options.maxRowBytes) && options.maxRowBytes > 0 ? options.maxRowBytes : 10_000;
  const toolLimit = approxBytesForTokens(TOOL_OUTPUT_TOKENS) - TRUNCATION_RESERVE_BYTES;

  const rows = [];
  const seenCalls = new Set();
  for (const event of events) {
    const built = rowOf(event, seenCalls);
    if (built === undefined) continue;
    for (const row of Array.isArray(built) ? built : [built]) {
      let text = redactSecrets(JSON.stringify(row.value));
      if (row.tier === "tool" && row.value.role === "tool") text = truncateText(text, toolLimit);
      text = truncateText(text, maxRowBytes - TRUNCATION_RESERVE_BYTES);
      rows.push({ tier: row.tier, text: `[${row.label}]\n${text}\n` });
    }
  }
  if (rows.length === 0) return "";

  let remaining = maxInputBytes - byteLength(OMITTED);
  const selected = new Array(rows.length).fill(undefined);
  for (const tier of TIER_ORDER) {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.tier !== tier) continue;
      if (remaining <= byteLength(OMITTED) + TRUNCATION_RESERVE_BYTES) continue;
      const budget = remaining - byteLength(OMITTED);
      const text = byteLength(row.text) <= budget
        ? row.text
        : truncateText(row.text, Math.max(0, budget - TRUNCATION_RESERVE_BYTES));
      remaining -= byteLength(text) + byteLength(OMITTED);
      selected[index] = text;
    }
  }

  let rendered = "";
  let gap = false;
  for (const text of selected) {
    if (text === undefined) {
      if (!gap) {
        rendered += OMITTED;
        gap = true;
      }
      continue;
    }
    rendered += text;
    gap = false;
  }
  return byteLength(rendered) > maxInputBytes ? "" : rendered;
}

/** Exported for tests. */
export const __internals = { rowOf, tierOfUserMessage, TIER_ORDER, OMITTED };

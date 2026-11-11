/**
 * Parse Codex's memory citation block out of an assistant message.
 *
 * The v2 read path asks the model to append exactly one block:
 *
 *   <oai-mem-citation>
 *   <citation_entries>
 *   rollout_summaries/foo.md:8-10|note=[used prior context]
 *   </citation_entries>
 *   <rollout_ids>
 *   session-...
 *   </rollout_ids>
 *   </oai-mem-citation>
 *
 * Citation paths and ids are the feedback edge that keeps useful memories in
 * the phase-2 selection; this module only extracts them.
 */

/** Collect text blocks from an assistant message content array. */
export function assistantText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/**
 * Extract cited summary paths and thread ids.
 *
 * @param text - assistant text that may contain citation blocks.
 * @returns `{ paths, ids }` deduplicated in first-seen order.
 */
export function parseMemoryCitation(text) {
  const paths = [];
  const ids = [];
  if (typeof text !== "string" || text === "") return { paths, ids };
  const blocks = text.matchAll(/<oai-mem-citation>([\s\S]*?)<\/oai-mem-citation>/g);
  for (const match of blocks) {
    const body = match[1];
    const entries = body.match(/<citation_entries>([\s\S]*?)<\/citation_entries>/);
    if (entries) {
      for (const line of entries[1].split("\n")) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        const beforeNote = trimmed.split("|note=[")[0];
        const lastColon = beforeNote.lastIndexOf(":");
        const candidate = (lastColon === -1 ? beforeNote : beforeNote.slice(0, lastColon)).trim();
        if (candidate.startsWith("rollout_summaries/") && candidate.endsWith(".md") && !paths.includes(candidate)) paths.push(candidate);
      }
    }
    const idBlock = body.match(/<(?:rollout_ids|thread_ids)>([\s\S]*?)<\/(?:rollout_ids|thread_ids)>/);
    if (idBlock) {
      for (const line of idBlock[1].split("\n")) {
        const id = line.trim();
        if (id !== "" && !ids.includes(id)) ids.push(id);
      }
    }
  }
  return { paths, ids };
}

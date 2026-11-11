/**
 * One-shot model helpers over `ctx.llm.stream`.
 *
 * The agent loop logs conversation requests; memory work is auxiliary, so these
 * calls carry an explicit `purpose` and never inherit the parent session's
 * history. The caller supplies provider/model from the triggering agent route.
 */

/**
 * Assemble the text of one model response.
 *
 * @param llm - `ctx.llm` service.
 * @param options - provider/model, system prompt, user text, effort, signal.
 * @returns the complete text.
 * @throws when the adapter reports an error or abort finish.
 */
export async function completeText(llm, options) {
  const {
    provider, model, system, prompt, reasoningEffort, signal, purpose = "memory",
    maxTokens,
  } = options;
  if (typeof provider !== "string" || typeof model !== "string") throw new Error("dsh-memory: no provider/model route for the memory call");
  const request = {
    provider,
    model,
    system,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    purpose,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(signal === undefined ? {} : { signal }),
  };
  let text = "";
  let blockText = "";
  for await (const chunk of llm.stream(request)) {
    if (chunk.type === "text-delta") text += chunk.text;
    else if (chunk.type === "block-end" && chunk.block?.type === "text") blockText += chunk.block.text;
    else if (chunk.type === "finish") {
      if (chunk.reason?.kind === "error") {
        throw new Error(`dsh-memory: model call failed: ${formatFailure(chunk.reason.failure)}`);
      }
      if (chunk.reason?.kind === "aborted") throw new Error("dsh-memory: model call aborted");
    }
  }
  return text !== "" ? text : blockText;
}

/** Render an LLM failure without leaking a request body. */
function formatFailure(failure) {
  if (failure === null || failure === undefined) return "unknown failure";
  if (typeof failure === "string") return failure;
  if (typeof failure.message === "string") return failure.message;
  try {
    return JSON.stringify(failure).slice(0, 500);
  } catch {
    return "unknown failure";
  }
}

/**
 * Parse the first JSON object in a model response, tolerating code fences and
 * a short prose prefix. Throws a teaching error when no object parses.
 *
 * @param text - model output.
 * @returns the parsed object.
 */
export function parseJsonObject(text) {
  if (typeof text !== "string") throw new Error("dsh-memory: model returned no text");
  let body = text.trim();
  const fenced = body.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`\s*$/i);
  if (fenced) body = fenced[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("dsh-memory: model response contains no JSON object");
  const candidate = body.slice(start, end + 1);
  try {
    const value = JSON.parse(candidate);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (error) {
    throw new Error(`dsh-memory: invalid JSON from model: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse a stage-1 output. Empty `rollout_summary` means "nothing to retain".
 * @returns `{ summary, slug }`.
 */
export function parseStageOneOutput(text) {
  const value = parseJsonObject(text);
  const summary = typeof value.rollout_summary === "string" ? value.rollout_summary.trim() : "";
  const slug = typeof value.rollout_slug === "string" ? value.rollout_slug.trim() : "";
  return { summary, slug };
}

/** Parse a consolidation output. */
export function parseConsolidationOutput(text) {
  const value = parseJsonObject(text);
  if (typeof value.memory_summary !== "string") throw new Error("dsh-memory: consolidation response has no memory_summary string");
  return value.memory_summary;
}

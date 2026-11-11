/**
 * dsh-memory: a host-only port of Codex's latest (v2) memory engine.
 *
 * The plugin runs a two-phase background pipeline on root-session start:
 * per-session rollout summaries, then global consolidation into
 * `memory_summary.md`. The summary plus Codex's v2 read-path instructions are
 * injected into every session, and four optional memory tools provide
 * progressive disclosure. State lives in a SQLite database under
 * `$DSH_HOME/memories_v2`; the durable DSH session log is the rollout source.
 */

import { readConfig } from "./src/config.js";
import { MemoryEngine } from "./src/engine.js";
import { memorySection } from "./src/read-path.js";
import { memoryTools } from "./src/tools.js";
import { assistantText } from "./src/citations.js";

export const name = "dsh-memory";
export const inject = ["llm", "sessionPersistence", "systemPrompt", "tools"];

/** A logger that tolerates every profile's logging shape. */
function createLogger(ctx) {
  const fallback = (level, message) => {
    if (level === "warn") console.error(message);
    else console.log(message);
  };
  const emit = (level, message) => {
    const logger = ctx.logger;
    const method = logger?.[level];
    if (typeof method === "function") {
      try {
        method.call(logger, message);
        return;
      } catch {}
    }
    fallback(level, message);
  };
  return {
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    debug: (message) => {
      if (typeof process !== "undefined" && process.env?.DSH_MEMORY_DEBUG === "1") emit("info", message);
    },
  };
}

/**
 * Mount the memory engine into one DSH profile.
 *
 * @param ctx - Cordis context carrying llm, sessionPersistence, systemPrompt, tools.
 * @param rawConfig - bundle-patch configuration; see README.md.
 */
export function apply(ctx, rawConfig) {
  const config = readConfig(rawConfig);
  if (!config.enabled) return;
  const logger = createLogger(ctx);
  const engine = new MemoryEngine({
    config,
    llm: ctx.llm,
    persistence: ctx.sessionPersistence,
    logger,
  });

  ctx.effect(() => ctx.systemPrompt.section(memorySection(engine, config, ctx.systemPrompt)));

  if (config.dedicatedTools) {
    ctx.effect(() => {
      const disposers = memoryTools({ root: config.root, engine }).map((definition) => ctx.tools.register(definition));
      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {}
        }
      };
    });
  }

  const offCreated = ctx.on("agent/created", (payload) => {
    try {
      if (!engine.eligible(payload)) return;
      engine.schedule(payload.agent, payload.source).catch((error) => {
        logger.warn(`dsh-memory: startup run rejected: ${error instanceof Error ? error.message : String(error)}`);
      });
    } catch (error) {
      logger.warn(`dsh-memory: agent/created handling failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const offCitation = ctx.on("session/event", (_session, event) => {
    try {
      if (event?.type !== "assistant/message") return;
      engine.recordCitationUsage(assistantText(event.data?.message?.content));
    } catch {}
  });

  ctx.effect(() => async () => {
    try {
      offCreated?.();
    } catch {}
    try {
      offCitation?.();
    } catch {}
    await engine.dispose();
  });

  if (config.log) logger.info(`dsh-memory: mounted at ${config.root}`);
  return engine;
}

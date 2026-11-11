/**
 * Background orchestration for the memory engine.
 *
 * One engine belongs to one mounted plugin. It serializes startup runs, keeps a
 * single store handle, and makes the read path available to the prompt section
 * and tools. A run is detached from the triggering turn: it reads persisted
 * sessions, never the live conversation, so it cannot delay or alter the turn
 * that started it.
 */

import { existsSync } from "node:fs";
import { ensureLayout, readSummary } from "./workspace.js";
import { parseMemoryCitation } from "./citations.js";
import { MemoryStore } from "./store.js";
import { isRootHeader, runPhase1 } from "./phase1.js";
import { runPhase2 } from "./phase2.js";

/** Resolve the model route for memory calls. */
export function routeFor(agent, config) {
  const selection = agent?.model?.current?.();
  let header;
  try {
    header = agent?.session?.requestHeader?.()?.config;
  } catch {}
  const provider = selection?.provider ?? header?.provider ?? agent?.options?.provider;
  const model = config?.extractModel ?? selection?.model ?? header?.model ?? agent?.options?.model;
  return { provider, model };
}

/** The engine's public surface for the plugin entry, tests, and read-path tools. */
export class MemoryEngine {
  constructor({ config, llm, persistence, logger, store }) {
    this.config = config;
    this.llm = llm;
    this.persistence = persistence;
    this.logger = logger;
    this.store = store;
    this.ownsStore = store === undefined;
    this.chain = Promise.resolve();
    this.abort = new AbortController();
    this.disposed = false;
    this.runs = 0;
    this.lastRun = undefined;
  }

  /** Open the state store on demand. */
  openStore() {
    if (this.store !== undefined) return this.store;
    ensureLayout(this.config.root);
    this.store = new MemoryStore(this.config.dbPath);
    return this.store;
  }

  /**
   * Decide whether one `agent/created` notification should start a pipeline.
   * @returns the source payload when eligible, else undefined.
   */
  eligible(payload) {
    if (!this.config.enabled || !this.config.generateMemories) return undefined;
    if (this.disposed) return undefined;
    if (payload?.source !== "startup" && payload?.source !== "resume") return undefined;
    if (!isRootHeader(payload?.agent?.session?.header)) return undefined;
    return payload;
  }

  /** Queue one startup run behind earlier runs. */
  schedule(agent, source) {
    const run = this.chain.then(() => this.run(agent, source));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Await every queued run. */
  whenIdle() {
    return this.chain;
  }

  /**
   * Run phase 1 and then phase 2 once.
   * @returns `{ phase1, phase2 }` counters for logs/tests.
   */
  async run(agent, source = "startup") {
    if (this.disposed) return undefined;
    const route = routeFor(agent, this.config);
    const workerId = agent?.id ?? "dsh-memory";
    const result = { source, phase1: undefined, phase2: undefined };
    try {
      const store = this.openStore();
      ensureLayout(this.config.root);
      await this.pruneMissingSessions(store);
      try {
        const pruned = store.pruneStage1(this.config.maxUnusedDays, 200);
        if (pruned > 0) this.logger?.info?.(`dsh-memory: pruned ${pruned} stale stage-1 output(s)`);
      } catch (error) {
        this.logger?.warn?.(`dsh-memory: stage-1 retention prune failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      result.phase1 = await runPhase1({
        store,
        persistence: this.persistence,
        llm: this.llm,
        config: this.config,
        route,
        currentSessionId: agent?.id,
        signal: this.abort.signal,
        logger: this.logger,
      });
      result.phase2 = await runPhase2({
        store,
        llm: this.llm,
        config: this.config,
        route,
        workerId,
        signal: this.abort.signal,
        logger: this.logger,
      });
      this.runs += 1;
      this.lastRun = { at: new Date().toISOString(), ...result };
      if (this.config.log) {
        this.logger?.info?.(`dsh-memory: run complete ${JSON.stringify({ phase1: result.phase1, phase2: result.phase2 })}`);
      }
    } catch (error) {
      this.logger?.warn?.(`dsh-memory: startup pipeline failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    return result;
  }

  /** Drop outputs whose source session no longer exists in durable storage. */
  async pruneMissingSessions(store) {
    for (const output of store.listOutputs()) {
      let snapshot;
      try {
        snapshot = await this.persistence.stat(output.threadId);
      } catch {
        continue;
      }
      if (snapshot === undefined) {
        try {
          store.deleteOutput(output.threadId);
          this.logger?.info?.(`dsh-memory: removed output for deleted session ${output.threadId}`);
        } catch {}
      }
    }
  }

  /** Run one pipeline now; exposed for tests and an explicit refresh. */
  async runNow(agent, source = "startup") {
    return this.schedule(agent, source);
  }

  /**
   * Record usage for memory citations in one assistant message.
   * Paths and thread ids are the same feedback edge Codex uses to keep useful
   * summaries in the phase-2 selection.
   *
   * @param text - assistant text that may contain an `<oai-mem-citation>` block.
   * @returns the number of output rows updated.
   */
  recordCitationUsage(text) {
    try {
      const { paths, ids } = parseMemoryCitation(text);
      if (paths.length === 0 && ids.length === 0) return 0;
      if (this.store === undefined && !existsSync(this.config.dbPath)) return 0;
      const store = this.openStore();
      const normalized = new Set();
      for (const path of paths) {
        const threadId = store.threadIdForSummaryFile(path.slice("rollout_summaries/".length));
        if (threadId !== undefined) normalized.add(threadId);
      }
      for (const id of ids) {
        normalized.add(id);
        if (!id.startsWith("session-")) normalized.add(`session-${id}`);
      }
      return store.recordUsage([...normalized]);
    } catch {
      return 0;
    }
  }

  /** Read the summary for prompt injection; undefined when absent/incompatible. */
  readSummaryForPrompt() {
    if (!this.config.enabled || !this.config.useMemories) return undefined;
    try {
      const current = readSummary(this.config.root, this.config.summaryMaxBytes);
      if (!current.valid || current.summary.trim() === "") return undefined;
      return current.summary;
    } catch {
      return undefined;
    }
  }

  /** Resolve and bump usage for a read/search path. */
  noteUsage(relativePath) {
    try {
      const store = this.openStore();
      if (relativePath.startsWith("rollout_summaries/")) {
        return store.recordUsageForSummaryFile(relativePath.slice("rollout_summaries/".length));
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /** Abort queued work and close the owned store after the chain settles. */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    try {
      await this.chain;
    } catch {}
    if (this.ownsStore && this.store !== undefined) {
      try {
        this.store.close();
      } catch {}
      this.store = undefined;
    }
  }
}

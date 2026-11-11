import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readConfig, memoryPaths } from "../src/config.js";

test("defaults resolve under DSH_HOME/memories_v2", () => {
  const config = readConfig({}, { DSH_HOME: "/tmp/dsh-home" });
  assert.equal(config.root, path.join("/tmp/dsh-home", "memories_v2"));
  assert.equal(config.dbPath, path.join(config.root, "memories_v2_1.sqlite"));
  assert.equal(config.minRolloutIdleHours, 6);
  assert.equal(config.maxRolloutAgeDays, 10);
  assert.equal(config.maxRolloutsPerStartup, 2);
  assert.equal(config.phase2CooldownSeconds, 21_600);
});

test("explicit home and memoryRoot override the layout", () => {
  const config = readConfig({ home: "/tmp/custom", memoryRoot: "/tmp/mem" }, {});
  assert.equal(config.root, "/tmp/mem");
  assert.equal(memoryPaths(config.root).summary, "/tmp/mem/memory_summary.md");
});

test("clamps the Codex ranges and rejects an unsupported version", () => {
  const config = readConfig({ minRolloutIdleHours: 0, maxRolloutsPerStartup: 999, maxUnusedDays: 9999, maxRawMemoriesForConsolidation: 99_999 }, {});
  assert.equal(config.minRolloutIdleHours, 1);
  assert.equal(config.maxRolloutsPerStartup, 128);
  assert.equal(config.maxUnusedDays, 365);
  assert.equal(config.maxRawMemoriesForConsolidation, 4096);
  assert.throws(() => readConfig({ version: "v1" }, {}), /unsupported memory version/);
});

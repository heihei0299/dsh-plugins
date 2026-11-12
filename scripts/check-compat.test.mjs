/**
 * Narrow self-checks for scripts/check-compat.mjs.
 *
 * These do not re-run the plugin suites: they pin the parts the tool itself
 * must get right — argument parsing, the documented exit codes, the
 * no-exemption evaluation seam — and run the real contract set against the
 * installed dsh. A two-version matrix is opt-in through
 * DSH_COMPAT_EXTRA_RUNTIMES (colon-separated dsh package directories).
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
	checkContracts,
	evaluateEngines,
	exitCodeFor,
	loadAppBoot,
	parseArgs,
	pluginDirs,
	readJson,
	resolveDshRoot,
	runCompatCheck,
	runPluginTests,
	testCounts
} from "./check-compat.mjs";

const dshRoot = resolveDshRoot();
const skipWithoutDsh = dshRoot === null && "no installed dsh on PATH";
/** Runtimes nobody verified against; accepting one of them means the range was loosened. */
const UNVERIFIED = ["0.2.1-rc.3", "0.2.1-alpha.1", "0.2.2-alpha.2", "0.2.2-alpha.3"];

test("parses the valid flags and rejects every malformed one", () => {
	assert.deepEqual(parseArgs(["--contracts-only", "--dsh", "/tmp/runtime", "--baseline", "b.json"]), {
		contractsOnly: true,
		help: false,
		dsh: "/tmp/runtime",
		baseline: "b.json"
	});
	assert.equal(parseArgs([]).contractsOnly, false);
	// A missing value, a flag passed as a value, and an unknown argument are all
	// errors: falling back to the installed dsh would check a version nobody asked for.
	for (const argv of [["--dsh"], ["--baseline"], ["--dsh", "--contracts-only"], ["--baseline", "--dsh", "/tmp/x"], ["--dsh", ""], ["--baseline", ""], ["--bogus"]]) {
		assert.match(parseArgs(argv).error, /.+/, argv.join(" "));
	}
});

test("argument errors exit 1 instead of checking the installed dsh", async () => {
	for (const argv of [["--dsh"], ["--dsh", "--contracts-only"], ["--baseline"], ["--bogus"]]) {
		const lines = [];
		const code = await runCompatCheck({ argv, log: (line) => lines.push(line), error: (line) => lines.push(line) });
		assert.equal(code, 1, argv.join(" "));
		const output = lines.join("\n");
		assert.match(output, /参数错误/, argv.join(" "));
		assert.doesNotMatch(output, /dsh 升级兼容性检查/, `${argv.join(" ")} 不应回退去检查当前版本`);
	}
});

test("reports pass and skip counts, never pass alone", () => {
	// Real summaries use "skipped"; the spec reporter and TAP differ only in prefix.
	assert.deepEqual(testCounts("ℹ tests 38\nℹ pass 37\nℹ skipped 1\n"), { pass: "37", skip: "1" });
	assert.deepEqual(testCounts("# tests 2\n# pass 2\n# skipped 0\n"), { pass: "2", skip: "0" });
	assert.deepEqual(testCounts("no counts here"), { pass: "?", skip: "?" });
});

test("the unit-test summary line carries both counts", async (t) => {
	const parent = await realpath(tmpdir());
	const prefix = "compat-test-summary-";
	const dir = await mkdtemp(join(parent, prefix));
	const resolved = await realpath(dir);
	assert.equal(dirname(resolved), parent);
	assert.ok(basename(resolved).startsWith(prefix));
	t.after(async () => {
		assert.equal(await realpath(dir), resolved);
		await rm(resolved, { recursive: true });
	});
	await mkdir(join(dir, "test"), { recursive: true });
	await writeFile(join(dir, "package.json"), JSON.stringify({
		name: "summary-fixture",
		private: true,
		scripts: { test: `node -e "console.log('ℹ pass 2');console.log('ℹ skipped 1')"` }
	}));
	const result = runPluginTests(dir);
	assert.equal(result.ok, true);
	assert.match(result.detail, /pass 2 \/ skip 1/);
});

test("a target app-boot without runtime version reporting fails closed", async (t) => {
	const parent = await realpath(tmpdir());
	const prefix = "compat-test-app-boot-";
	const dir = await mkdtemp(join(parent, prefix));
	const resolved = await realpath(dir);
	assert.equal(dirname(resolved), parent);
	assert.ok(basename(resolved).startsWith(prefix));
	t.after(async () => {
		assert.equal(await realpath(dir), resolved);
		await rm(resolved, { recursive: true });
	});
	const boot = join(dir, "node_modules", "@deepseek-ai", "dsh-app-boot");
	await mkdir(boot, { recursive: true });
	await writeFile(join(dir, "package.json"), '{"name":"fixture","version":"1.0.0"}');
	await writeFile(join(boot, "package.json"), '{"name":"@deepseek-ai/dsh-app-boot","version":"1.0.0","type":"module","exports":"./index.js"}');
	await writeFile(join(boot, "index.js"), "export function evaluatePluginCompatibility() {}\n");
	await assert.rejects(loadAppBoot(dir), /getDshRuntimeVersion/);
});

test("--help states that the default run may write build artifacts", async () => {
	const lines = [];
	const code = await runCompatCheck({ argv: ["--help"], log: (line) => lines.push(line), error: (line) => lines.push(line) });
	assert.equal(code, 0);
	const output = lines.join("\n");
	assert.match(output, /pretest/);
	assert.match(output, /dist\//);
	assert.match(output, /--contracts-only/);
});

test("keeps the documented exit codes", () => {
	assert.equal(exitCodeFor({ failures: 0, drifted: false }), 0);
	assert.equal(exitCodeFor({ failures: 0, drifted: true }), 2);
	assert.equal(exitCodeFor({ failures: 1, drifted: false }), 1);
	assert.equal(exitCodeFor({ failures: 1, drifted: true }), 1);
});

test("evaluates engines.dsh through the supplied app-boot with an empty exemption table", () => {
	const calls = [];
	const appBoot = {
		evaluatePluginCompatibility(manifest, exemptions) {
			calls.push(exemptions);
			return undefined;
		}
	};
	assert.deepEqual(evaluateEngines({ name: "demo", version: "1.0.0" }, appBoot), { ok: true });
	assert.deepEqual(calls, [{}], "an exemption would hide a row the boot preflight denies");

	const rejecting = {
		evaluatePluginCompatibility: () => ({ requirements: { "engines.dsh": "0.2.1-rc.2" }, runtimeVersion: "0.2.1-rc.5" }),
		pluginCompatibilityWarning: (issue) => `incompatible with ${issue.runtimeVersion}`
	};
	const verdict = evaluateEngines({ name: "demo", version: "1.0.0" }, rejecting);
	assert.equal(verdict.ok, false);
	assert.match(verdict.warning, /incompatible with 0\.2\.1-rc\.5/);
	assert.throws(() => evaluateEngines({}, {}), /evaluatePluginCompatibility/);
});

test("every contract still matches the installed dsh", { skip: skipWithoutDsh }, () => {
	const results = checkContracts(dshRoot);
	assert.ok(results.length > 0);
	assert.deepEqual(results.filter((result) => !result.ok), []);
});

test("the real app-boot accepts every manifest and rejects unverified runtimes", { skip: skipWithoutDsh }, async () => {
	const appBoot = await loadAppBoot(dshRoot);
	const runtime = appBoot.getDshRuntimeVersion();
	for (const dir of pluginDirs()) {
		const label = dir.split("/").pop();
		const manifest = readJson(join(dir, "package.json"));
		assert.equal(appBoot.evaluatePluginCompatibility(manifest, {}), undefined, `${label} 被 dsh ${runtime} 拒绝`);
		for (const other of UNVERIFIED) {
			assert.notEqual(
				appBoot.evaluatePluginCompatibility(manifest, {}, other),
				undefined,
				`${label} 的 engines.dsh 意外接受了未验证的 ${other}，范围被放宽了`
			);
		}
	}
});

test("a contracts-only run reports engines and contracts but no unit tests", { skip: skipWithoutDsh }, async () => {
	const lines = [];
	const code = await runCompatCheck({
		argv: ["--contracts-only"],
		log: (line) => lines.push(line),
		error: (line) => lines.push(line)
	});
	assert.notEqual(code, 1, lines.join("\n"));
	const output = lines.join("\n");
	assert.match(output, /\[PASS\] engines\.dsh /);
	assert.match(output, /app-boot .*（与启动 preflight 同一评估函数，无豁免）/);
	assert.match(output, /\[SKIP\] 单测（--contracts-only 只跑契约）/);
});

const extraRuntimes = (process.env.DSH_COMPAT_EXTRA_RUNTIMES ?? "").split(":").filter((entry) => entry.trim() !== "");

test("extra matrix runtimes accept every manifest and contract", {
	skip: extraRuntimes.length === 0 && "set DSH_COMPAT_EXTRA_RUNTIMES=<dir>[:<dir>] to run a version matrix"
}, async () => {
	for (const entry of extraRuntimes) {
		const root = resolveDshRoot(entry);
		const appBoot = await loadAppBoot(root);
		const runtime = appBoot.getDshRuntimeVersion();
		for (const dir of pluginDirs()) {
			const label = dir.split("/").pop();
			const manifest = readJson(join(dir, "package.json"));
			assert.equal(appBoot.evaluatePluginCompatibility(manifest, {}), undefined, `${label} 被 dsh ${runtime} 拒绝`);
		}
		assert.deepEqual(checkContracts(root).filter((result) => !result.ok), [], `dsh ${runtime} 的契约集`);
	}
});

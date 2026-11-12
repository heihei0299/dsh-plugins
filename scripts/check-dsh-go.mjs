#!/usr/bin/env node
/**
 * Gate the dsh-go adaptation of every plugin directory.
 *
 * dsh-go reads one `dshGo` manifest field and one host registration; both live
 * in this repository, so they can be checked without the App. The rules here
 * are the ones the bridge grammar actually evidences (see
 * `docs/dsh-go-bridge.md`): protocol v1, bounded contribution budgets, panel ids
 * that every entry point resolves to, and a host module that really registers
 * the panel the manifest advertises.
 *
 * A plugin without `dshGo` is not a failure: adaption is per plugin. It is
 * reported as SKIP so the run still shows which plugins are done.
 *
 * Dependency-free on purpose: it must run on a bare checkout, before any
 * install or build is authorized.
 *
 * Usage: node scripts/check-dsh-go.mjs [plugin-dir...]
 * Exit codes: 0 every adapted plugin passes; 1 a contract violation.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_TITLE = 24;
const MAX_PANEL_TITLE = 16;
const MAX_COMPOSER_ACTIONS = 2;
const MAX_COMPOSER_TOOLS = 2;
const MAX_PANELS = 4;
const PLACEMENTS = new Set(["session.tab", "features"]);
// Only these positions are evidenced by the bridge. The App guide lists more
// surfaces (status bar, message menu, turn footer, conversation actions), but
// their manifest keys are unknown, so this gate refuses invented ones instead
// of shipping a manifest the App silently ignores.
const POSITIONS = new Set(["composer.actions", "composer.tools", "panels"]);

/**
 * Read a text file, or "" when it is missing.
 * @param file - absolute path.
 * @returns file contents.
 */
function readText(file) {
	return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/**
 * List every plugin directory below the repository root.
 * @param base - directory to scan.
 * @returns absolute plugin directories.
 */
export function pluginDirs(base = root) {
	return readdirSync(base)
		.map((name) => path.join(base, name))
		.filter((dir) => {
			if (!statSync(dir).isDirectory() || !existsSync(path.join(dir, "package.json"))) return false;
			try {
				const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
				return manifest.dsh?.bundle?.patch !== undefined;
			} catch {
				return false;
			}
		});
}

/**
 * Count Unicode scalar values, the unit the bridge budgets use.
 * @param value - any string.
 * @returns scalar count.
 */
function scalarLength(value) {
	return [...String(value)].length;
}

/**
 * Validate one localized label: scalar text, or a zh/en map of scalar text.
 * @param value - manifest field.
 * @param limit - maximum scalar count.
 * @returns an error message, or undefined when valid.
 */
function labelProblem(value, limit) {
	if (value === undefined) return "缺失";
	if (typeof value === "string") return value.trim() === "" ? "为空" : scalarLength(value) > limit ? `超过 ${limit} 字` : undefined;
	if (value === null || typeof value !== "object" || Array.isArray(value)) return "既不是字符串也不是语言映射";
	for (const language of ["zh", "en"]) {
		if (typeof value[language] !== "string" || value[language].trim() === "") return `缺少 ${language} 文本`;
	}
	const longest = Math.max(...Object.values(value).map(scalarLength));
	return longest > limit ? `超过 ${limit} 字` : undefined;
}

/**
 * Find the JS modules a plugin ships for the bridge.
 * @param dir - plugin directory.
 * @param manifest - parsed package.json.
 * @returns concatenated module text.
 */
function bridgeSourceOf(dir, manifest) {
	const entry = path.resolve(dir, manifest.main ?? "./index.js");
	const files = [entry];
	for (const relative of ["src/dsh-go", "lib/dsh-go"]) {
		const candidate = path.join(dir, relative);
		if (!existsSync(candidate)) continue;
		for (const name of readdirSync(candidate)) {
			if (name.endsWith(".js")) files.push(path.join(candidate, name));
		}
	}
	return files.filter((file) => existsSync(file)).map(readText).join("\n");
}

/**
 * Whether package.files ships the bridge modules.
 * @param manifest - parsed package.json.
 * @param dir - plugin directory.
 * @returns true when a files entry covers src/dsh-go or lib/dsh-go.
 */
function shipsBridge(manifest, dir) {
	const relative = existsSync(path.join(dir, "lib/dsh-go")) ? "lib/dsh-go" : "src/dsh-go";
	const entries = Array.isArray(manifest.files) ? manifest.files : [];
	return entries.some((entry) => {
		if (typeof entry !== "string") return false;
		const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
		return normalized === relative || normalized.startsWith(`${relative}/`) || relative.startsWith(`${normalized}/`) || normalized === path.dirname(relative);
	});
}

/**
 * Whether any test file mentions the bridge.
 * @param dir - plugin directory.
 * @returns true when a dsh-go test exists.
 */
function hasBridgeTest(dir) {
	const tests = path.join(dir, "test");
	if (!existsSync(tests)) return false;
	return readdirSync(tests).some((name) => name.includes("dsh-go") && name.endsWith(".js"));
}

/**
 * Check one plugin.
 * @param dir - plugin directory.
 * @returns `{name, adapted, problems, summary}`.
 */
export function checkPlugin(dir) {
	const name = path.basename(dir);
	const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
	const dshGo = manifest.dshGo;
	if (dshGo === undefined) return { name, adapted: false, problems: [], summary: "未适配" };

	const problems = [];
	const fail = (message) => problems.push(message);
	if (dshGo.v !== 1) fail(`dshGo.v 必须是 1，实际是 ${JSON.stringify(dshGo.v)}`);
	const titleProblem = labelProblem(dshGo.title, MAX_TITLE);
	if (titleProblem !== undefined) fail(`dshGo.title ${titleProblem}`);
	if (typeof dshGo.icon !== "string" || dshGo.icon.trim() === "") fail("dshGo.icon 必须是非空字符串");

	const contributes = dshGo.contributes;
	if (contributes === null || typeof contributes !== "object" || Array.isArray(contributes)) {
		fail("dshGo.contributes 必须是对象");
		return { name, adapted: true, problems, summary: "contributes 无效" };
	}
	const positions = Object.keys(contributes);
	if (positions.length === 0) fail("dshGo.contributes 为空，没有声明任何原生位置");
	for (const position of positions) {
		if (!POSITIONS.has(position)) fail(`未验证的位置 ${position}；已证据化的只有 ${[...POSITIONS].join(", ")}`);
	}

	const panels = Array.isArray(contributes.panels) ? contributes.panels : [];
	if (panels.length > MAX_PANELS) fail(`panels 超过 ${MAX_PANELS} 个`);
	const panelIds = new Set();
	for (const panel of panels) {
		if (typeof panel?.id !== "string" || !ID.test(panel.id)) fail(`panel id 不合法：${JSON.stringify(panel?.id)}`);
		else panelIds.add(panel.id);
		const panelTitle = labelProblem(panel?.title, MAX_PANEL_TITLE);
		if (panelTitle !== undefined) fail(`panel "${panel?.id}" title ${panelTitle}`);
		const placement = Array.isArray(panel?.placement) ? panel.placement : [];
		if (placement.length === 0) fail(`panel "${panel?.id}" 没有 placement`);
		for (const slot of placement) {
			if (!PLACEMENTS.has(slot)) fail(`panel "${panel?.id}" 的 placement "${slot}" 未验证；可用 ${[...PLACEMENTS].join(", ")}`);
		}
	}
	const unique = [];
	for (const [position, rows] of Object.entries(contributes)) {
		if (!Array.isArray(rows)) {
			fail(`contributes.${position} 必须是行数组`);
			continue;
		}
		for (const row of rows) {
			if (typeof row?.id !== "string" || !ID.test(row.id)) fail(`${position} 的 id 不合法：${JSON.stringify(row?.id)}`);
			else if (unique.includes(row.id)) fail(`id "${row.id}" 在 ${position} 重复`);
			else unique.push(row.id);
		}
	}

	const actions = Array.isArray(contributes["composer.actions"]) ? contributes["composer.actions"] : [];
	if (actions.length > MAX_COMPOSER_ACTIONS) fail(`composer.actions 超过 ${MAX_COMPOSER_ACTIONS} 个`);
	for (const action of actions) {
		const labelProblemText = labelProblem(action?.label, 24);
		if (labelProblemText !== undefined) fail(`composer.actions "${action?.id}" label ${labelProblemText}`);
		if (action?.effect?.type !== "open") fail(`composer.actions "${action?.id}" 的 effect.type 只验证过 "open"`);
		const page = action?.effect?.page;
		const target = typeof page === "string" && page.startsWith("panel:") ? page.slice("panel:".length) : undefined;
		if (target === undefined) fail(`composer.actions "${action?.id}" 的 effect.page 必须是 panel:<id>`);
		else if (!panelIds.has(target)) fail(`composer.actions "${action?.id}" 指向不存在的面板 "${target}"`);
	}

	const tools = Array.isArray(contributes["composer.tools"]) ? contributes["composer.tools"] : [];
	if (tools.length > MAX_COMPOSER_TOOLS) fail(`composer.tools 超过 ${MAX_COMPOSER_TOOLS} 个`);
	for (const tool of tools) {
		const labelProblemText = labelProblem(tool?.label, 24);
		if (labelProblemText !== undefined) fail(`composer.tools "${tool?.id}" label ${labelProblemText}`);
		if (typeof tool?.panel !== "string" || !panelIds.has(tool.panel)) fail(`composer.tools "${tool?.id}" 指向不存在的面板 "${tool?.panel}"`);
	}

	if (Buffer.byteLength(JSON.stringify(dshGo), "utf8") >= MAX_MANIFEST_BYTES) fail(`dshGo manifest 超过 ${MAX_MANIFEST_BYTES} 字节`);

	const source = bridgeSourceOf(dir, manifest);
	if (!/dshGo/.test(source) || !/\.panel\s*\(/.test(source)) fail("Host 模块没有调用 ctx.dshGo.panel(...)，面板不会注册");
	if (!shipsBridge(manifest, dir)) fail("package.json files 未包含 dsh-go 模块目录，安装后注册代码缺失");
	if (!hasBridgeTest(dir)) fail("test/ 下没有 dsh-go 测试文件，manifest 与面板行为没有回归保护");

	return {
		name,
		adapted: true,
		problems,
		summary: `panels: ${[...panelIds].join(", ") || "—"}`
	};
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const targets = process.argv.slice(2).map((dir) => path.resolve(dir));
	const dirs = targets.length > 0 ? targets : pluginDirs(root);
	let failures = 0;
	for (const dir of dirs) {
		let result;
		try {
			result = checkPlugin(dir);
		} catch (error) {
			failures += 1;
			console.log(`[FAIL] ${path.basename(dir)} — ${error.message}`);
			continue;
		}
		if (!result.adapted) {
			console.log(`[SKIP] ${result.name.padEnd(24)} 未适配 dsh-go`);
			continue;
		}
		if (result.problems.length === 0) {
			console.log(`[PASS] ${result.name.padEnd(24)} ${result.summary}`);
			continue;
		}
		failures += 1;
		console.log(`[FAIL] ${result.name.padEnd(24)} ${result.summary}`);
		for (const problem of result.problems) console.log(`       ${problem}`);
	}
	console.log("");
	if (failures > 0) {
		console.log(`结论：${failures} 个插件的 dsh-go manifest 不符合已验证的桥接语法。`);
		process.exitCode = 1;
	} else {
		console.log("结论：已适配插件的 dsh-go manifest 与注册入口一致（原生视图未在真实 App 上验收）。");
	}
}

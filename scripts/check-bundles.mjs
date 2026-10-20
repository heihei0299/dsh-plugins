#!/usr/bin/env node
/**
 * Gate every plugin directory on the bundle contract.
 *
 * The repository rule is that a plugin ships as a DSH plugin bundle: an
 * installable package whose `package.json` declares `dsh.bundle.patch`, so the
 * WebUI plugin manager can list it, enable or disable it, and remove it without
 * anyone hand-editing a `file://` patch entry. This script checks that
 * mechanically against the same fields the DSH plugin manager reads
 * (`readPluginMeta`, `bundlePatchPaths`, `evaluatePluginCompatibility`), so a
 * plugin that would be unsupported or disabled in the WebUI fails here first.
 *
 * Dependency-free on purpose: it must run on a bare checkout, before any
 * install or build is authorized.
 *
 * Usage: node scripts/check-bundles.mjs [plugin-dir...]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_TYPES = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp"]);
const MAX_ICON_BYTES = 256 * 1024;
const REQUIRED_LOCALES = ["en", "zh"];

/**
 * Read a plugin's package.json.
 * @param dir - plugin directory.
 * @returns the parsed manifest.
 */
function manifestOf(dir) {
	return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

/**
 * Check one plugin against the bundle contract.
 * @param dir - plugin directory.
 * @returns the problems found, each phrased as a failure.
 */
function problemsOf(dir) {
	const problems = [];
	const fail = (message) => problems.push(message);
	let manifest;
	try {
		manifest = manifestOf(dir);
	} catch (error) {
		return [`package.json is unreadable: ${error.message}`];
	}
	if (typeof manifest.name !== "string" || manifest.name.trim() === "") fail("package.json declares no name");
	if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version)) fail("package.json declares no semver version");

	// dsh.bundle.patch is what makes the package a bundle at all: without it the
	// plugin manager installs the package as a plain dependency and cannot offer
	// an enable/disable switch.
	const patched = manifest.dsh?.bundle?.patch;
	const patches = typeof patched === "string" ? [patched] : Array.isArray(patched) ? patched : [];
	if (patches.length === 0) fail('declares no dsh.bundle.patch, so the plugin manager refuses it as "not a bundle"');
	for (const patch of patches) {
		if (typeof patch !== "string" || patch.trim() === "") {
			fail("dsh.bundle.patch must contain file paths");
			continue;
		}
		const file = path.resolve(dir, patch);
		if (!file.startsWith(`${dir}${path.sep}`)) fail(`dsh.bundle.patch escapes the package: ${patch}`);
		else if (!existsSync(file)) fail(`dsh.bundle.patch names a missing file: ${patch}`);
		else if (readFileSync(file, "utf8").trim() === "") fail(`bundle patch is empty: ${patch}`);
	}

	// The loader resolves the entry through the package exports map.
	if (typeof manifest.exports?.["."] !== "string") fail('exports no "." module for the loader entry');

	// One checkable dsh requirement: engines.dsh decides alone, dsh peers otherwise.
	const dshPeers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-"));
	if (typeof manifest.engines?.dsh !== "string" && dshPeers.length === 0) fail("declares neither engines.dsh nor an @deepseek-ai/dsh peer, so compatibility cannot be checked");

	// The plugin manager card reads `meta.title` / `meta.description` from
	// locale/<language>.json through the exports map.
	for (const language of REQUIRED_LOCALES) {
		const file = path.join(dir, "locale", `${language}.json`);
		if (!existsSync(file)) {
			fail(`has no locale/${language}.json, so the plugin card falls back to the package name`);
			continue;
		}
		if (manifest.exports?.["./locale/*.json"] === void 0) fail('exports no "./locale/*.json", so the plugin card cannot read its metadata');
		let dictionary;
		try {
			dictionary = JSON.parse(readFileSync(file, "utf8"));
		} catch (error) {
			fail(`locale/${language}.json is unreadable: ${error.message}`);
			continue;
		}
		for (const field of ["title", "description"]) {
			const value = dictionary.meta?.[field];
			if (typeof value !== "string" || value.trim() === "") fail(`locale/${language}.json has no meta.${field}`);
		}
	}

	// An icon comes from the manifest field or the exported resource, both of
	// which must stay inside the package and under the size limit.
	const icon = typeof manifest.icon === "string" ? manifest.icon : manifest.exports?.["./icon"];
	if (typeof icon !== "string") {
		fail('exports no icon (manifest "icon" or "./icon"), so the plugin card shows a default');
	} else if (!ICON_TYPES.has(path.extname(icon).toLowerCase())) {
		fail(`icon must be SVG, PNG, JPEG or WebP: ${icon}`);
	} else if (!existsSync(path.join(dir, icon))) {
		fail(`icon file is missing: ${icon}`);
	} else if (statSync(path.join(dir, icon)).size > MAX_ICON_BYTES) {
		fail(`icon exceeds 256 KiB: ${icon}`);
	}
	return problems;
}

/**
 * List the plugin directories to check.
 * @returns absolute plugin directories.
 */
function pluginDirs() {
	const named = process.argv.slice(2).map((entry) => path.resolve(process.cwd(), entry));
	if (named.length > 0) return named;
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
		.map((entry) => path.join(root, entry.name))
		.filter((dir) => existsSync(path.join(dir, "package.json")));
}

let failed = 0;
const checked = pluginDirs();
if (checked.length === 0) {
	console.error("check-bundles: found no plugin package to check");
	process.exit(1);
}
for (const dir of checked) {
	const problems = problemsOf(dir);
	const label = path.relative(root, dir) || dir;
	if (problems.length === 0) {
		console.log(`ok   ${label}`);
		continue;
	}
	failed += 1;
	console.log(`FAIL ${label}`);
	for (const problem of problems) console.log(`     - ${problem}`);
}
console.log(`\n${String(checked.length - failed)}/${String(checked.length)} plugin(s) satisfy the bundle contract`);
process.exit(failed === 0 ? 0 : 1);

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

test("declares the bundle layer the plugin manager reads", () => {
	assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.ok(existsSync(path.join(root, manifest.dsh.bundle.patch)), "the declared bundle patch must exist");
	assert.ok(readFileSync(path.join(root, manifest.dsh.bundle.patch), "utf8").trim().length > 0);
});

test("bundle patch inserts the entry the package exports", () => {
	const patch = readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
	assert.match(patch, /- insert:\n {4}- id: history-budget\n {6}name: '@local\/dsh-history-budget'\n$/);
});

test("ships no browser half: the pager enhancements were removed, not repaired", () => {
	assert.equal(manifest.dsh?.client, undefined, "a host-only bundle declares no client half");
	assert.equal(manifest.exports?.["./client"], undefined, "the loader must resolve no client entry");
	assert.ok(!(manifest.files ?? []).includes("client.js"), "the packed file list must not name a client bundle");
	assert.ok(!existsSync(path.join(root, "client.js")), "no client bundle may be left behind");
});

test("exports the host entry the loader resolves", () => {
	assert.equal(manifest.exports?.["."], "./index.js");
	assert.ok(existsSync(path.join(root, "index.js")));
});

test("declares one dsh requirement the plugin manager can check", () => {
	assert.equal(typeof manifest.engines?.dsh, "string");
});

test("exports an icon inside the package", () => {
	const icon = manifest.exports?.["./icon"];
	assert.equal(icon, "./assets/icon.svg");
	const file = path.join(root, icon);
	assert.ok(existsSync(file), "the exported icon must exist");
	assert.ok(statSync(file).size <= 256 * 1024, "the icon must stay under the 256 KiB limit");
});

test("carries a plugin-card title and description in both locales", () => {
	assert.equal(manifest.exports?.["./locale/*.json"], "./locale/*.json");
	for (const language of ["en", "zh"]) {
		const dictionary = JSON.parse(readFileSync(path.join(root, "locale", `${language}.json`), "utf8"));
		assert.equal(typeof dictionary.meta?.title, "string");
		assert.ok(dictionary.meta.title.trim().length > 0);
		assert.equal(typeof dictionary.meta?.description, "string");
		assert.ok(dictionary.meta.description.trim().length > 0);
	}
});

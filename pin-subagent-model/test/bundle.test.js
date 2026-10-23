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
});

test("bundle patch inserts the entry the plugin exports", () => {
	const patch = readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
	assert.match(patch, /- insert:\n {4}- id: pin-subagent-model\n {6}name: dsh-plugin-pin-subagent-model\n$/);
});

test("bundle patch ships no route, so enabling it before configuring cannot fail", () => {
	const patch = readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
	const body = patch.replace(/^\s*#.*$/gm, "");
	assert.doesNotMatch(body, /provider:|model:/, "the pin belongs to the profile layer, not the bundle layer");
});

test("declares one dsh requirement the plugin manager can check", () => {
	const enginesDsh = manifest.engines?.dsh;
	const dshPeers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-"));
	assert.ok(typeof enginesDsh === "string" || dshPeers.length > 0, "engines.dsh or an @deepseek-ai/dsh peer must exist");
});

test("exports an icon inside the package", () => {
	const icon = manifest.exports?.["./icon"];
	assert.equal(icon, "./assets/icon.svg");
	const file = path.join(root, icon);
	assert.ok(existsSync(file), "the exported icon must exist");
	assert.ok(statSync(file).size <= 256 * 1024, "the icon must stay under the 256 KiB limit");
});

test("declares the build-free browser half the client module graph reads", () => {
	assert.equal(manifest.exports?.["./client"], "./client.js");
	assert.ok(existsSync(path.join(root, manifest.exports["./client"])), "the exported client bundle must exist");
	assert.ok(manifest.files.includes("client.js"), "the published package must carry the client bundle");
	assert.equal(manifest.dsh?.client?.platform, "web");
	const inject = manifest.dsh?.client?.inject;
	assert.ok(Array.isArray(inject), "dsh.client.inject must list the client rows this bundle uses");
	for (const dependency of [
		"@deepseek-ai/dsh-api-remotes",
		"@deepseek-ai/dsh-api-session-controller",
		"@deepseek-ai/dsh-client-locale",
		"@deepseek-ai/dsh-client-ui-conversation",
		"@deepseek-ai/dsh-client-ui-plugin-manager",
		"@deepseek-ai/dsh-client-ui-session",
		"@deepseek-ai/dsh-client-ui-settings"
	]) {
		assert.ok(inject.includes(dependency), `dsh.client.inject must include ${dependency}`);
	}
});

test("declares the schema library behind the WebUI configuration page", () => {
	assert.equal(typeof manifest.peerDependencies?.["@deepseek-ai/schemastery"], "string");
	assert.match(manifest.peerDependencies["@deepseek-ai/schemastery"], /^\D*\d+\.\d+\.\d+/);
	assert.equal(manifest.version, "0.4.0");
});

for (const language of ["en", "zh"]) {
	test(`locale/${language}.json localizes the plugin card`, () => {
		assert.equal(manifest.exports?.["./locale/*.json"], "./locale/*.json");
		const dictionary = JSON.parse(readFileSync(path.join(root, "locale", `${language}.json`), "utf8"));
		for (const field of ["title", "description"]) {
			assert.equal(typeof dictionary.meta?.[field], "string");
			assert.notEqual(dictionary.meta[field].trim(), "");
		}
	});
}

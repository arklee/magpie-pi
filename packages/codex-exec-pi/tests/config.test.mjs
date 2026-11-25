import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig, resolveEnabled, saveEnabled } from "../extension/config.mjs";

async function tempFile(t) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "codex-exec-config-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return path.join(dir, "nested", "codex-exec-pi.json");
}

test("a missing config has no saved setting", async (t) => {
	assert.deepEqual(await loadConfig(await tempFile(t)), {});
});

test("saveEnabled writes, keeps other keys and removes the setting for auto", async (t) => {
	const file = await tempFile(t);
	await saveEnabled(file, true);
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { enabled: true });
	await writeFile(file, JSON.stringify({ enabled: true, note: "kept" }));
	await saveEnabled(file, false);
	assert.deepEqual(await loadConfig(file), { enabled: false, note: "kept" });
	await saveEnabled(file, undefined);
	assert.deepEqual(await loadConfig(file), { note: "kept" });
});

test("invalid configs are reported and never overwritten", async (t) => {
	const file = await tempFile(t);
	await saveEnabled(file, true);
	await writeFile(file, "{ nope");
	assert.match((await loadConfig(file)).error, /invalid JSON/);
	await assert.rejects(saveEnabled(file, false), /invalid JSON/);
	assert.equal(await readFile(file, "utf8"), "{ nope");
	await writeFile(file, JSON.stringify({ enabled: "yes" }));
	assert.match((await loadConfig(file)).error, /must be true or false/);
});

test("the flag beats the saved setting, which beats the model's provider", () => {
	assert.deepEqual(resolveEnabled({ flag: true, saved: false, provider: "anthropic" }), { enabled: true, reason: "--codex-exec flag" });
	assert.deepEqual(resolveEnabled({ flag: false, saved: false, provider: "openai" }), { enabled: false, reason: "saved setting" });
	assert.deepEqual(resolveEnabled({ flag: false, saved: true, provider: "anthropic" }), { enabled: true, reason: "saved setting" });
	assert.equal(resolveEnabled({ flag: false, saved: undefined, provider: "openai" }).enabled, true);
	assert.equal(resolveEnabled({ flag: false, saved: undefined, provider: "openai-codex" }).enabled, true);
	assert.deepEqual(resolveEnabled({ flag: false, saved: undefined, provider: "anthropic" }), { enabled: false, reason: "auto, anthropic model" });
	assert.equal(resolveEnabled({ flag: false, saved: undefined, provider: undefined }).enabled, false);
});

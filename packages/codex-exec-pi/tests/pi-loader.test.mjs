import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("Pi loads the extension without local peer dependencies", async (t) => {
	const pi = process.env.CODEX_EXEC_TEST_PI;
	if (!pi) return t.skip("Set CODEX_EXEC_TEST_PI to the path of a Pi 1.6.0 executable");
	const root = await mkdtemp(path.join(os.tmpdir(), "codex-exec-loader-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await cp(new URL("../extension/", import.meta.url), path.join(root, "extension"), { recursive: true });
	const help = execFileSync(pi, ["-ne", "-e", path.join(root, "extension", "index.ts"), "--help"], {
		cwd: root,
		env: { ...process.env, PI_CODING_AGENT_DIR: path.join(root, "agent") },
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.match(help, /--codex-exec\s+Start with Codex-style exec mode enabled/);
});

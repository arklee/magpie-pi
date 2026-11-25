import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
import {cp, mkdtemp, readFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";

test("Pi 1.6.0 loads the extension without local peer dependencies", async t => {
 const pi = process.env.MAGPIE_TEST_PI;
 if (!pi) return t.skip("Set MAGPIE_TEST_PI to the path to Pi 1.6.0");
 const root = await mkdtemp(path.join(os.tmpdir(), "magpie-pi-loader-"));
 t.after(() => rm(root, {recursive:true, force:true}));
 await cp(new URL("../extension/", import.meta.url), path.join(root, "extension"), {recursive:true});
 const state = path.join(root, "state");
 execFileSync(pi, ["-ne", "-e", path.join(root, "extension", "index.ts"), "--list-models"], {
  cwd:root,
  env:{...process.env, PI_CODING_AGENT_DIR:path.join(root, "agent"), MAGPIE_PI_STATE:state},
  timeout:30000,
 });
 assert.deepEqual(JSON.parse(await readFile(path.join(state, "config.json"), "utf8")).plugins, []);
});

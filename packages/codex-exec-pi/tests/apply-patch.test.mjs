import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	applyPatchText,
	extractPatchedPaths,
	formatApplyPatchResult,
	normalizeApplyPatchArguments,
	parsePatch,
	PatchParseError,
} from "../extension/apply-patch/apply.mjs";

async function workspace(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), "codex-exec-patch-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

const exists = (file) => access(file).then(() => true, () => false);

test("add, update, move and delete files", async (t) => {
	const root = await workspace(t);
	await writeFile(path.join(root, "a.txt"), "one\ntwo\nthree\n");
	await writeFile(path.join(root, "old.txt"), "keep\nchange\n");
	await writeFile(path.join(root, "gone.txt"), "x\n");
	const result = await applyPatchText(
		root,
		[
			"*** Begin Patch",
			"*** Add File: dir/new.txt",
			"+hello",
			"+world",
			"*** Update File: a.txt",
			"@@",
			" one",
			"-two",
			"+TWO",
			" three",
			"*** Update File: old.txt",
			"*** Move to: moved/new-name.txt",
			"@@",
			" keep",
			"-change",
			"+changed",
			"*** Delete File: gone.txt",
			"*** End Patch",
		].join("\n"),
	);
	assert.deepEqual(result.failures, []);
	assert.deepEqual(result.summaries, [
		"add: dir/new.txt",
		"update: a.txt",
		"move: old.txt -> moved/new-name.txt",
		"delete: gone.txt",
	]);
	assert.equal(await readFile(path.join(root, "dir/new.txt"), "utf8"), "hello\nworld\n");
	assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "one\nTWO\nthree\n");
	assert.equal(await readFile(path.join(root, "moved/new-name.txt"), "utf8"), "keep\nchanged\n");
	assert.equal(await exists(path.join(root, "old.txt")), false);
	assert.equal(await exists(path.join(root, "gone.txt")), false);
	assert.equal(formatApplyPatchResult(result), result.summaries.join("\n"));
});

test("updates preserve CRLF line endings of untouched lines", async (t) => {
	const root = await workspace(t);
	await writeFile(path.join(root, "w.txt"), "a\r\nb\r\nc\r\n");
	await applyPatchText(root, "*** Begin Patch\n*** Update File: w.txt\n@@\n a\n-b\n+B\n c\n*** End Patch");
	assert.equal(await readFile(path.join(root, "w.txt"), "utf8"), "a\r\nB\r\nc\r\n");
});

test("context lines match despite whitespace and typographic punctuation", async (t) => {
	const root = await workspace(t);
	await writeFile(path.join(root, "q.txt"), "say “hi”  \nend\n");
	const result = await applyPatchText(root, '*** Begin Patch\n*** Update File: q.txt\n@@\n-say "hi"\n+say hello\n end\n*** End Patch');
	assert.deepEqual(result.failures, []);
	assert.ok(result.fuzz > 0);
	assert.equal(await readFile(path.join(root, "q.txt"), "utf8"), "say hello\nend\n");
});

test("failures are reported with recovery instructions while later hunks apply", async (t) => {
	const root = await workspace(t);
	await writeFile(path.join(root, "a.txt"), "a\n");
	await mkdir(path.join(root, "sub"));
	const result = await applyPatchText(
		root,
		"*** Begin Patch\n*** Update File: a.txt\n@@\n-missing\n+x\n*** Update File: nope.txt\n@@\n-a\n+b\n*** Add File: sub/ok.txt\n+ok\n*** End Patch",
	);
	assert.equal(result.hasPartialSuccess, true);
	assert.deepEqual(result.recoveryInstructions.mustReadFiles, ["a.txt"]);
	assert.deepEqual(result.failures.map((failure) => failure.code), [undefined, "ENOENT"]);
	const text = formatApplyPatchResult(result);
	assert.match(text, /^apply_patch partially failed\./);
	assert.match(text, /Recovery: MUST read a\.txt before retrying\./);
	assert.match(text, /Earlier file actions in this patch were already applied\./);
	assert.equal(await readFile(path.join(root, "sub/ok.txt"), "utf8"), "ok\n");
});

test("invalid patches are rejected before touching files", () => {
	assert.throws(() => parsePatch("*** Update File: a\n"), PatchParseError);
	assert.throws(() => parsePatch("*** Begin Patch\n*** Frobnicate: a\n*** End Patch"), /not a valid hunk header/);
	assert.throws(() => parsePatch("*** Begin Patch\n*** Add File: a\nno plus\n*** End Patch"), /must start with '\+'/);
	return assert.rejects(() => applyPatchText(os.tmpdir(), "*** Begin Patch\n*** End Patch"), /empty patch/);
});

test("heredoc wrappers, paths and argument shapes are normalized", () => {
	const patch = "cat <<'EOF'\n*** Begin Patch\n*** Add File: x.txt\n+x\n*** Update File: y\n*** Move to: z\n*** End Patch\nEOF";
	assert.deepEqual(parsePatch(patch).map((hunk) => hunk.filePath), ["x.txt", "y"]);
	assert.deepEqual(extractPatchedPaths(patch), ["x.txt", "y", "z"]);
	assert.deepEqual(normalizeApplyPatchArguments("p"), { input: "p" });
	assert.deepEqual(normalizeApplyPatchArguments({ input: "q" }), { input: "q" });
	assert.deepEqual(normalizeApplyPatchArguments(null), { input: "" });
});

test("file mutations go through the supplied queue", async (t) => {
	const root = await workspace(t);
	const queued = [];
	await applyPatchText(root, "*** Begin Patch\n*** Add File: q.txt\n+q\n*** End Patch", {
		queue: (file, operation) => {
			queued.push(path.basename(file));
			return operation();
		},
	});
	assert.deepEqual(queued, ["q.txt"]);
});

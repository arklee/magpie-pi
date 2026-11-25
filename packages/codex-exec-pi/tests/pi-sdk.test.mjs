// End-to-end: the extension inside a real Pi SDK session, driven by Pi's scripted faux model.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import extension from "../extension/index.ts";

async function createSession(t, responses) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "codex-exec-sdk-"));
	const agentDir = path.join(dir, "agent");
	const faux = fauxProvider({ provider: "faux", models: [{ id: "model" }] });
	const contexts = [];
	faux.setResponses(
		responses.map((respond) => (context) => {
			contexts.push(context);
			return respond(context);
		}),
	);
	const modelRuntime = await ModelRuntime.create({ authPath: path.join(dir, "auth.json"), modelsPath: path.join(dir, "models.json") });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("faux", "test");
	const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir, extensionFactories: [extension], noExtensions: true });
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager: SettingsManager.inMemory({ defaultTools: ["read", "bash", "edit", "write"] }),
		sessionManager: SessionManager.inMemory(dir),
	});
	await session.bindExtensions({});
	t.after(async () => {
		session.dispose();
		await rm(dir, { recursive: true, force: true });
	});
	return { session, dir, contexts };
}

function toolResults(session) {
	return session.messages
		.filter((message) => message.role === "toolResult")
		.map((message) => ({ name: message.toolName, text: message.content.map((block) => block.text ?? "").join("\n"), isError: message.isError }));
}

function lastToolText(context) {
	const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
	return result.content.map((block) => block.text ?? "").join("\n");
}

const PATCH = "*** Begin Patch\n*** Add File: notes/hello.txt\n+hello from a cell\n*** End Patch";

test("exec hides other tools, edits through apply_patch and resumes nested calls after a yield", { timeout: 60_000 }, async (t) => {
	const { session, dir, contexts } = await createSession(t, [
		() =>
			fauxAssistantMessage(
				fauxToolCall("exec", {
					code: [
						`const summary = await tools.apply_patch(${JSON.stringify(PATCH)});`,
						'const content = await tools.read({ path: "notes/hello.txt" });',
						"text(summary); text(content.trim());",
					].join("\n"),
				}),
			),
		() =>
			fauxAssistantMessage(
				fauxToolCall("exec", {
					code: '// @exec: {"yield_time_ms": 20}\ntext("first"); await new Promise(r => setTimeout(r, 300));\nconst again = await tools.read({ path: "notes/hello.txt" }); text("second: " + again.trim());',
				}),
			),
		(context) => {
			const cellId = /cell ID (\d+)/.exec(lastToolText(context))?.[1];
			return fauxAssistantMessage(fauxToolCall("wait", { cell_id: cellId, yield_time_ms: 10_000 }));
		},
		() => fauxAssistantMessage(fauxToolCall("exec", { code: "null.boom" })),
		() => fauxAssistantMessage("done"),
	]);
	await session.prompt("/codex-exec on");
	assert.deepEqual(
		session.getActiveToolNames().filter((name) => ["exec", "wait", "apply_patch", "edit", "write"].includes(name)).sort(),
		["apply_patch", "exec", "wait"],
	);
	await session.prompt("go");

	const system = contexts[0].messages.find((message) => message.role === "system");
	assert.match(system.sections.tools, /- exec: .*\n- wait: /);
	assert.doesNotMatch(system.sections.tools, /- (read|bash|apply_patch):/);
	const declared = contexts[0].messages.flatMap((message) => message.toolsAdded ?? []);
	const exec = declared.find((tool) => tool.name === "exec");
	assert.match(exec.description, /- tools\.apply_patch\(input: string\)/);
	assert.match(exec.description, /- tools\.read\(args: \{ path: string/);
	assert.match(exec.description, /- tools\.bash\(args:/);

	const results = toolResults(session);
	assert.deepEqual(results.map((result) => result.name), ["exec", "exec", "wait", "exec"]);
	assert.equal(results[0].text, "add: notes/hello.txt\nhello from a cell");
	assert.equal(await readFile(path.join(dir, "notes/hello.txt"), "utf8"), "hello from a cell\n");
	assert.match(results[1].text, /^Script running with cell ID \d+\.[^\n]*\nfirst$/);
	assert.equal(results[2].text, "second: hello from a cell");
	assert.equal(results[3].isError, true);
	assert.match(results[3].text, /^Script error:\nTypeError: Cannot read properties of null/);

	await session.prompt("/codex-exec off");
	const active = session.getActiveToolNames();
	assert.ok(active.includes("edit") && active.includes("write"));
	assert.ok(!active.includes("exec") && !active.includes("wait") && !active.includes("apply_patch"));
});

test("apply_patch works as a direct tool without exec mode", { timeout: 60_000 }, async (t) => {
	const { session, dir } = await createSession(t, [
		() => fauxAssistantMessage(fauxToolCall("apply_patch", { input: PATCH })),
		() => fauxAssistantMessage(fauxToolCall("apply_patch", { input: "*** Begin Patch\n*** Update File: missing.txt\n@@\n-a\n+b\n*** End Patch" })),
		() => fauxAssistantMessage("done"),
	]);
	session.setActiveToolsByName([...session.getActiveToolNames(), "apply_patch"]);
	await session.prompt("go");
	const results = toolResults(session);
	assert.equal(results[0].text, "add: notes/hello.txt");
	assert.equal(await readFile(path.join(dir, "notes/hello.txt"), "utf8"), "hello from a cell\n");
	assert.equal(results[1].isError, true);
	assert.match(results[1].text, /^apply_patch failed\.\nFailed:\n- missing\.txt \(update\): ENOENT/);
});

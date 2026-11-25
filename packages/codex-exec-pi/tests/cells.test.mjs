import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackend, resolveBackendKind } from "../extension/backends/index.mjs";
import { cellTools } from "../extension/catalog.mjs";
import { CellManager } from "../extension/cells.mjs";
import { toToolResult } from "../extension/results.mjs";

const TOOLS = cellTools([
	{
		name: "echo",
		description: "Echo arguments",
		parameters: { type: "object", properties: { value: {} } },
	},
	{
		name: "apply_patch",
		description: "Patch",
		parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
	},
	{ name: "fail", description: "Always fails", parameters: { type: "object" } },
	{ name: "mcp__dev-x__search", description: "Search", parameters: { type: "object" } },
]);

function outcome(result, isError = false) {
	return { toolCall: {}, result, isError };
}

function createScope(log = []) {
	return {
		log,
		async executeTool(name, args) {
			log.push({ name, args });
			if (name === "fail") return outcome({ content: [{ type: "text", text: "boom" }] }, true);
			if (name === "slow") return outcome({ content: [{ type: "text", text: "slow" }] });
			return outcome({ content: [{ type: "text", text: JSON.stringify(args) }], structuredContent: { echoed: args } });
		},
	};
}

function texts(response) {
	return response.items.filter((item) => item.type === "text").map((item) => item.text);
}

function createManager(store) {
	return new CellManager({ backend: createBackend("vm"), store });
}

async function run(manager, source, ms = 5000, scope = createScope()) {
	const cell = manager.start({ source, tools: TOOLS, maxOutputTokens: 1000 });
	return manager.observe(cell, ms, scope);
}

test("backend selection defaults to vm and reserves quickjs", () => {
	assert.equal(resolveBackendKind(undefined), "vm");
	assert.equal(resolveBackendKind(" VM "), "vm");
	assert.equal(resolveBackendKind("quickjs"), "quickjs");
	assert.throws(() => createBackend("quickjs"), /not implemented yet/);
	assert.throws(() => resolveBackendKind("v8"), /Unknown exec backend "v8"/);
});

test("a cell prints text, discards values and supports top-level await", async () => {
	const manager = createManager();
	const response = await run(manager, 'text("a"); text({ b: 1n, c: [1] }); 42; await Promise.resolve(); text("after")');
	assert.equal(response.kind, "result");
	assert.deepEqual(texts(response), ["a", '{"b":"1n","c":[1]}', "after"]);
	assert.equal(response.errorText, undefined);
});

test("every cell starts with a fresh context and no host APIs", async () => {
	const manager = createManager();
	await run(manager, "globalThis.leak = 1; var shared = 2;");
	const response = await run(
		manager,
		"text([typeof leak, typeof shared, typeof console, typeof require, typeof process, typeof fetch, typeof setTimeout].join())",
	);
	assert.deepEqual(texts(response), ["undefined,undefined,undefined,undefined,undefined,undefined,function"]);
});

test("tool calls resolve structured results, accept positional strings and reject failures", async () => {
	const manager = createManager();
	const scope = createScope();
	const response = await run(
		manager,
		[
			"const a = await tools.echo({ value: 1 });",
			'const b = await tools.apply_patch("*** Begin Patch");',
			'const c = await tools.mcp__dev_x__search({ q: "x" });',
			"let d; try { await tools.fail({}); } catch (e) { d = e instanceof Error ? e.message : 'not an error'; }",
			"text([a, b, c, d]);",
			"text(ALL_TOOLS.map(t => t.name + ':' + t.usage).join(';'));",
		].join("\n"),
		5000,
		scope,
	);
	assert.equal(response.errorText, undefined);
	assert.deepEqual(JSON.parse(texts(response)[0]), [
		{ echoed: { value: 1 } },
		{ echoed: { input: "*** Begin Patch" } },
		{ echoed: { q: "x" } },
		"boom",
	]);
	assert.match(texts(response)[1], /^echo:tools\.echo\(args: \{ value\?: unknown \}\);apply_patch:tools\.apply_patch\(input: string\)/);
	assert.deepEqual(
		scope.log.map((entry) => entry.name),
		["echo", "apply_patch", "mcp__dev-x__search", "fail"],
	);
});

test("errors report the cell line and keep earlier output", async () => {
	const manager = createManager();
	const response = await run(manager, 'text("before");\n\nnull.x;');
	assert.equal(response.kind, "result");
	assert.deepEqual(texts(response), ["before"]);
	assert.match(response.errorText, /^TypeError: Cannot read properties of null/);
	assert.match(response.errorText, /exec-cell\.js:3:/);
	const syntax = await run(manager, "text(1)\nlet = = 2");
	assert.match(syntax.errorText, /SyntaxError/);
	assert.match(syntax.errorText, /exec-cell\.js:2/);
	const result = toToolResult(response, 1000);
	assert.equal(result.isError, true);
	assert.equal(result.content.at(-1).text.startsWith("Script error:\nTypeError"), true);
});

test("exit ends a cell successfully, including from a timer", async () => {
	const manager = createManager();
	const response = await run(manager, 'text(1); exit(); text(2);');
	assert.deepEqual(texts(response), ["1"]);
	assert.equal(response.errorText, undefined);
	const timer = await run(manager, 'setTimeout(() => { text("t"); exit(); }, 5); await new Promise(() => {});');
	assert.deepEqual(texts(timer), ["t"]);
	assert.equal(timer.errorText, undefined);
});

test("timers run before the cell settles and clearTimeout cancels them", async () => {
	const manager = createManager();
	const response = await run(
		manager,
		'const id = setTimeout(() => text("cancelled"), 1); clearTimeout(id);\nawait new Promise(r => setTimeout(r, 20)); text("done");',
	);
	assert.deepEqual(texts(response), ["done"]);
});

test("a slow cell yields, keeps running and is collected by later observations", async () => {
	const manager = createManager();
	const cell = manager.start({
		source: 'text("start"); await new Promise(r => setTimeout(r, 300)); text("end");',
		tools: TOOLS,
		maxOutputTokens: 1000,
	});
	const first = await manager.observe(cell, 50, createScope());
	assert.equal(first.kind, "yielded");
	assert.deepEqual(texts(first), ["start"]);
	assert.match(toToolResult(first, 1000).content[0].text, new RegExp(`^Script running with cell ID ${cell.id}\\.`));
	const second = await manager.observe(cell, 5000, createScope());
	assert.equal(second.kind, "result");
	assert.deepEqual(texts(second), ["end"]);
	assert.match(manager.lookup(cell.id).missing, /already finished/);
	assert.match(manager.lookup("999").missing, /Unknown exec cell 999/);
});

test("a busy synchronous loop still yields and can be terminated", async () => {
	const manager = createManager();
	const cell = manager.start({ source: 'text("spin"); for (;;) {}', tools: TOOLS, maxOutputTokens: 1000 });
	const first = await manager.observe(cell, 100, createScope());
	assert.equal(first.kind, "yielded");
	assert.deepEqual(texts(first), ["spin"]);
	const stopped = await manager.terminate(cell);
	assert.equal(stopped.kind, "terminated");
	assert.match(toToolResult(stopped, 1000).content[0].text, /Script terminated/);
});

test("yield_control returns immediately while the cell continues", async () => {
	const manager = createManager();
	const cell = manager.start({
		source: 'text("partial"); yield_control(); await new Promise(r => setTimeout(r, 50)); text("rest");',
		tools: TOOLS,
		maxOutputTokens: 1000,
	});
	const started = Date.now();
	const first = await manager.observe(cell, 10_000, createScope());
	assert.equal(first.kind, "yielded");
	assert.ok(Date.now() - started < 2000);
	const second = await manager.observe(cell, 5000, createScope());
	assert.deepEqual(texts(second), ["rest"]);
});

test("tool calls made while nobody observes wait for the next observation", async () => {
	const manager = createManager();
	const cell = manager.start({
		source: 'await new Promise(r => setTimeout(r, 100)); const v = await tools.echo({ value: "late" }); text(v.echoed.value);',
		tools: TOOLS,
		maxOutputTokens: 1000,
	});
	const firstScope = createScope();
	assert.equal((await manager.observe(cell, 20, firstScope)).kind, "yielded");
	await new Promise((resolve) => setTimeout(resolve, 250));
	assert.equal(firstScope.log.length, 0);
	const secondScope = createScope();
	const second = await manager.observe(cell, 5000, secondScope);
	assert.deepEqual(texts(second), ["late"]);
	assert.equal(secondScope.log.length, 1);
});

test("an observation waits for in-flight tool calls before yielding", async () => {
	const manager = createManager();
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let finished = false;
	const scope = {
		async executeTool() {
			await gate;
			finished = true;
			return outcome({ content: [{ type: "text", text: "ok" }] });
		},
	};
	const cell = manager.start({ source: "await tools.echo({}); for (;;) {}", tools: TOOLS, maxOutputTokens: 1000 });
	const observation = manager.observe(cell, 20, scope);
	setTimeout(release, 100);
	const response = await observation;
	assert.equal(response.kind, "yielded");
	assert.equal(finished, true);
	await manager.terminate(cell);
});

test("aborting the observing call terminates the cell", async () => {
	const manager = createManager();
	const controller = new AbortController();
	const cell = manager.start({ source: "for (;;) {}", tools: TOOLS, maxOutputTokens: 1000 });
	setTimeout(() => controller.abort(), 30);
	const response = await manager.observe(cell, 10_000, { ...createScope(), signal: controller.signal });
	assert.equal(response.kind, "terminated");
	assert.deepEqual(manager.liveCells, []);
});

test("store values persist across cells and enforce JSON", async () => {
	const store = new Map();
	const manager = createManager(store);
	await run(manager, 'store("n", { count: 1 }); store("gone", 1); store("gone", undefined);');
	assert.deepEqual([...store], [["n", '{"count":1}']]);
	const response = await run(manager, 'text(load("n").count + 1); text(typeof load("gone")); try { store("f", () => 1) } catch (e) { text(e.message) }');
	assert.deepEqual(texts(response), ["2", "undefined", "store expects a JSON-serializable value"]);
});

test("images are validated and returned as Pi image content", async () => {
	const manager = createManager();
	const response = await run(
		manager,
		'image("data:image/png;base64,AAAA"); image({ type: "image", data: "BBBB", mimeType: "image/jpeg" }); try { image("https://x/y.png") } catch (e) { text(e.name) }',
	);
	assert.deepEqual(response.items, [
		{ type: "image", data: "AAAA", mimeType: "image/png" },
		{ type: "image", data: "BBBB", mimeType: "image/jpeg" },
		{ type: "text", text: "TypeError" },
	]);
});

test("notify goes to progress updates, not to the output", async () => {
	const manager = createManager();
	const updates = [];
	const response = await run(manager, 'notify("working"); text("out")', 5000, { ...createScope(), onUpdate: (text) => updates.push(text) });
	assert.deepEqual(texts(response), ["out"]);
	assert.deepEqual(updates, ["working"]);
});

test("the heap limit stops a runaway cell", { timeout: 60_000 }, async () => {
	const manager = new CellManager({ backend: createBackend("vm", { heapMiB: 32 }) });
	const response = await run(manager, "const a = []; for (;;) a.push(new Array(1e5).fill(Math.random()));", 30_000);
	assert.equal(response.kind, "result");
	assert.match(response.errorText, /memory limit/);
});

test("the number of running cells is bounded and terminateAll stops them", async () => {
	const manager = createManager();
	const cells = [];
	for (let index = 0; index < 8; index++) cells.push(manager.start({ source: "for (;;) {}", tools: TOOLS, maxOutputTokens: 1 }));
	assert.throws(() => manager.start({ source: "1", tools: TOOLS, maxOutputTokens: 1 }), /Too many running exec cells/);
	await manager.terminateAll();
	assert.deepEqual(manager.liveCells, []);
});

test("repeated waits back off", () => {
	const manager = createManager();
	const cell = { yieldedWaits: 1 };
	assert.equal(manager.waitTime(cell, 10_000), 10_000);
	assert.equal(manager.waitTime(cell, 1000), 5000);
	cell.yieldedWaits = 3;
	assert.equal(manager.waitTime(cell, 10_000), 40_000);
});

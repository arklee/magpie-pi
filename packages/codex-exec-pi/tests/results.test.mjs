import assert from "node:assert/strict";
import { test } from "node:test";
import { boundOutput, outcomeToValue, toToolResult } from "../extension/results.mjs";

test("tool outcomes become cell values", () => {
	assert.deepEqual(outcomeToValue({ isError: false, result: { content: [], structuredContent: { a: 1 } } }), { a: 1 });
	assert.equal(outcomeToValue({ isError: false, result: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }), "a\nb");
	assert.deepEqual(
		outcomeToValue({ isError: false, result: { content: [{ type: "image", data: "AA", mimeType: "image/png" }] } }),
		[{ type: "image", data: "AA", mimeType: "image/png" }],
	);
	assert.throws(() => outcomeToValue({ isError: true, result: { content: [{ type: "text", text: "denied" }] } }), /denied/);
	assert.deepEqual(outcomeToValue({ isError: true, result: { content: [], structuredContent: { exit_code: 1 } } }), { exit_code: 1 });
});

test("long output keeps its start and end", () => {
	const items = [{ type: "text", text: "A".repeat(100) }, { type: "text", text: "B".repeat(100) }];
	const [bounded] = boundOutput(items, 20);
	assert.ok(bounded.text.startsWith("A".repeat(48)));
	assert.ok(bounded.text.endsWith("B".repeat(32)));
	assert.match(bounded.text, /characters omitted/);
});

test("images beyond the limit are replaced by a note", () => {
	const items = Array.from({ length: 10 }, () => ({ type: "image", data: "AA", mimeType: "image/png" }));
	const content = boundOutput(items, 100);
	assert.equal(content.filter((item) => item.type === "image").length, 8);
	assert.match(content.at(-1).text, /2 more image/);
});

test("results describe running, terminated, failed and empty cells", () => {
	assert.equal(toToolResult({ kind: "result", cellId: "1", items: [] }, 10).content[0].text, "Script completed with no output.");
	const yielded = toToolResult({ kind: "yielded", cellId: "3", items: [{ type: "text", text: "x" }] }, 10);
	assert.match(yielded.content[0].text, /^Script running with cell ID 3\./);
	assert.equal(yielded.content[1].text, "x");
	assert.equal(yielded.details.status, "yielded");
	const failed = toToolResult({ kind: "result", cellId: "4", items: [{ type: "text", text: "x" }], errorText: "Error: no" }, 10);
	assert.equal(failed.isError, true);
	assert.deepEqual(failed.content.map((item) => item.text), ["x", "Script error:\nError: no"]);
	assert.match(toToolResult({ kind: "terminated", cellId: "5", items: [] }, 10).content[0].text, /terminated/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ExecSourceError, parseExecSource } from "../extension/source.mjs";

test("plain source passes through", () => {
	assert.deepEqual(parseExecSource('text("hi")'), { source: 'text("hi")' });
});

test("options line is parsed and replaced by an empty line", () => {
	const parsed = parseExecSource('// @exec: {"yield_time_ms": 500, "max_output_tokens": 20}\ntext(1)\ntext(2)');
	assert.deepEqual(parsed, { source: "\ntext(1)\ntext(2)", yieldTimeMs: 500, maxOutputTokens: 20 });
	assert.equal(parsed.source.split("\n")[1], "text(1)");
});

test("markdown fences are stripped", () => {
	assert.equal(parseExecSource("```js\ntext(1)\n```").source, "text(1)");
});

test("invalid input is rejected", () => {
	assert.throws(() => parseExecSource(42), ExecSourceError);
	assert.throws(() => parseExecSource("   "), /requires JavaScript/);
	assert.throws(() => parseExecSource("// @exec: {bad}\nx"), /not valid JSON/);
	assert.throws(() => parseExecSource('// @exec: {"timeout_ms": 1}\nx'), /Unsupported exec option: timeout_ms/);
	assert.throws(() => parseExecSource('// @exec: {"yield_time_ms": -1}\nx'), /yield_time_ms/);
	assert.throws(() => parseExecSource('// @exec: {"max_output_tokens": 0}\nx'), /max_output_tokens/);
	assert.throws(() => parseExecSource('// @exec: {"yield_time_ms": 1}'), /followed by JavaScript/);
	assert.throws(() => parseExecSource("// @exec: [1]\nx"), /JSON object/);
});

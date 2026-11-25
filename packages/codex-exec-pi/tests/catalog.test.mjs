import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildExecDescription,
	cellTools,
	nestedTools,
	reachesTools,
	schemaToType,
	stringParameter,
	toIdentifier,
	toolSignature,
} from "../extension/catalog.mjs";

const read = {
	name: "read",
	description: "Read a file.\n\nLong details that are not listed.",
	parameters: {
		type: "object",
		properties: { path: { type: "string" }, limit: { type: "integer" }, mode: { enum: ["a", "b"] } },
		required: ["path"],
	},
};
const patch = {
	name: "apply_patch",
	description: "Patch files.",
	parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
};

test("identifiers replace characters that are not valid in JavaScript", () => {
	assert.equal(toIdentifier("mcp__dev-radius__search"), "mcp__dev_radius__search");
	assert.equal(toIdentifier("1tool"), "_1tool");
});

test("schemas render as compact TypeScript types", () => {
	assert.equal(schemaToType(read.parameters), '{ path: string; limit?: number; mode?: "a" | "b" }');
	assert.equal(schemaToType({ type: "array", items: { type: ["string", "null"] } }), "Array<string | null>");
	assert.equal(schemaToType({ type: "array", items: { type: "number" } }), "number[]");
	assert.equal(schemaToType({ type: "object", properties: { "a-b": { const: 1 } } }), '{ "a-b"?: 1 }');
	assert.equal(schemaToType(undefined), "unknown");
});

test("single required string parameters are passed positionally", () => {
	assert.equal(stringParameter(patch.parameters), "input");
	assert.equal(stringParameter(read.parameters), undefined);
	assert.equal(toolSignature(patch), "tools.apply_patch(input: string)");
	assert.equal(toolSignature(read), 'tools.read(args: { path: string; limit?: number; mode?: "a" | "b" })');
});

test("cell tools exclude orchestration tools and carry usage", () => {
	const tools = cellTools([read, patch, { name: "exec" }, { name: "codemode" }, read]);
	assert.deepEqual(
		tools.map((tool) => [tool.name, tool.exposed, tool.stringParam]),
		[
			["read", "read", undefined],
			["apply_patch", "apply_patch", "input"],
		],
	);
	assert.equal(tools[0].description, "Read a file.");
});

test("the exec description lists callable tools and names deferred ones", () => {
	const loadout = {
		callable: [read, patch, { name: "wait", description: "", parameters: {} }, { name: "mcp__x__y", description: "MCP", parameters: {} }],
		getExposure: (name) => (name.startsWith("mcp__") ? "deferred" : "direct"),
		getPromptGuidelines: (name) => (name === "apply_patch" ? ["Use apply_patch for edits."] : []),
	};
	const description = buildExecDescription(nestedTools(loadout));
	assert.match(description, /Tools available in exec:\n- tools\.read\(args: .*\): Read a file\./);
	assert.match(description, /- tools\.apply_patch\(input: string\): Patch files\.\n {2}- Use apply_patch for edits\./);
	assert.match(description, /More tools, not described here .*tools\.mcp__x__y/);
	assert.doesNotMatch(description, /tools\.wait/);
});

test("reachesTools reports words or all", () => {
	assert.deepEqual(reachesTools({ code: "await tools.read({}); tools.read" }), ["await", "tools", "read"]);
	assert.equal(reachesTools({ code: "text(ALL_TOOLS)" }), "all");
	assert.deepEqual(reachesTools({}), []);
});

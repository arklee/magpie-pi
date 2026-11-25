// Model-facing descriptions for exec/wait and the listing of tools callable from cells.

import { DEFAULT_EXEC_YIELD_MS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_WAIT_YIELD_MS } from "./limits.mjs";

/** Tools that never appear inside cells: the orchestration tools themselves and Pi's own codemode. */
export const RESERVED_TOOL_NAMES = new Set(["exec", "wait", "codemode"]);

const LISTING_BUDGET_CHARS = 16_000;
const DESCRIPTION_MAX_CHARS = 400;
const SIGNATURE_MAX_CHARS = 600;
const GUIDELINE_MAX = 4;

export function toIdentifier(name) {
	let identifier = String(name).replace(/[^A-Za-z0-9_$]/g, "_");
	if (identifier === "" || /^[0-9]/.test(identifier)) identifier = `_${identifier}`;
	return identifier;
}

function literal(value) {
	return JSON.stringify(value) ?? "unknown";
}

function propertyKey(name) {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function union(types) {
	const unique = [...new Set(types)];
	if (unique.length === 0) return "never";
	return unique.length === 1 ? unique[0] : unique.join(" | ");
}

/** A compact TypeScript-like rendering of a JSON Schema, enough for a model to call a tool. */
export function schemaToType(schema, depth = 0) {
	if (schema === true || schema === undefined) return "unknown";
	if (schema === false) return "never";
	if (schema === null || typeof schema !== "object") return "unknown";
	if ("const" in schema) return literal(schema.const);
	if (Array.isArray(schema.enum)) return union(schema.enum.map(literal));
	const variants = schema.anyOf ?? schema.oneOf;
	if (Array.isArray(variants)) return union(variants.map((variant) => schemaToType(variant, depth)));
	if (Array.isArray(schema.type))
		return union(schema.type.map((type) => schemaToType({ ...schema, type }, depth)));
	switch (schema.type) {
		case "string":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "boolean":
			return "boolean";
		case "null":
			return "null";
		case "array": {
			const item = schemaToType(schema.items, depth + 1);
			return /[ |]/.test(item) ? `Array<${item}>` : `${item}[]`;
		}
		case "object":
		case undefined: {
			const properties = schema.properties;
			if (!properties || typeof properties !== "object") return schema.type === "object" ? "object" : "unknown";
			if (depth >= 3) return "object";
			const required = new Set(Array.isArray(schema.required) ? schema.required : []);
			const fields = Object.entries(properties).map(
				([name, property]) =>
					`${propertyKey(name)}${required.has(name) ? "" : "?"}: ${schemaToType(property, depth + 1)}`,
			);
			return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
		}
		default:
			return "unknown";
	}
}

/**
 * The parameter name of a tool whose only argument is a required string, such as apply_patch's
 * `input`. Cells may then pass the string itself: `tools.apply_patch(patch)`.
 */
export function stringParameter(schema) {
	if (!schema || typeof schema !== "object" || schema.type !== "object") return undefined;
	const names = Object.keys(schema.properties ?? {});
	if (names.length !== 1) return undefined;
	const [name] = names;
	const required = Array.isArray(schema.required) && schema.required.includes(name);
	return required && schema.properties[name]?.type === "string" ? name : undefined;
}

function clip(text, max) {
	return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** First paragraph of a description, on one line. */
export function summarize(description, max = DESCRIPTION_MAX_CHARS) {
	const paragraph = String(description ?? "").trim().split(/\n\s*\n/)[0] ?? "";
	return clip(paragraph.replace(/\s+/g, " "), max);
}

export function toolSignature(tool) {
	const identifier = toIdentifier(tool.name);
	const stringParam = stringParameter(tool.parameters);
	const args = stringParam ? `${stringParam}: string` : `args: ${schemaToType(tool.parameters)}`;
	return clip(`tools.${identifier}(${args})`, SIGNATURE_MAX_CHARS);
}

function renderEntry(tool, guidelines) {
	const summary = summarize(tool.description);
	const lines = [`- ${toolSignature(tool)}${summary ? `: ${summary}` : ""}`];
	for (const guideline of guidelines.slice(0, GUIDELINE_MAX)) lines.push(`  - ${summarize(guideline, 300)}`);
	return lines.join("\n");
}

/** The tools a cell can call, in the form the worker needs. */
export function cellTools(tools) {
	const seen = new Set();
	const result = [];
	for (const tool of tools) {
		if (RESERVED_TOOL_NAMES.has(tool.name) || seen.has(tool.name)) continue;
		seen.add(tool.name);
		result.push({
			name: tool.name,
			exposed: toIdentifier(tool.name),
			description: summarize(tool.description),
			usage: toolSignature(tool),
			stringParam: stringParameter(tool.parameters),
		});
	}
	return result;
}

/**
 * Splits a Pi tool loadout into tools listed in the exec description and tools that are only
 * reachable by name. Deferred tools (for example most MCP tools) are never listed, so the
 * description stays stable while servers connect.
 */
export function nestedTools(loadout) {
	const listed = [];
	const unlisted = [];
	for (const tool of loadout.callable) {
		if (RESERVED_TOOL_NAMES.has(tool.name)) continue;
		if (loadout.getExposure(tool.name) === "deferred") unlisted.push(tool);
		else listed.push({ tool, guidelines: [...(loadout.getPromptGuidelines(tool.name) ?? [])] });
	}
	return { listed, unlisted };
}

const EXEC_INTRO = `Run a JavaScript cell that computes and composes tool calls. Send JavaScript source only: no JSON wrapper, no markdown fences.
Optional first line: // @exec: {"yield_time_ms": ${DEFAULT_EXEC_YIELD_MS}, "max_output_tokens": ${DEFAULT_MAX_OUTPUT_TOKENS}} (the defaults).
Every exec starts a fresh, restricted JavaScript context: top-level await works; nothing carries over between cells except store() values. There is no console, import, require, process, fetch or other Node/browser API; reach the host only through tools.
Expression values and return values are discarded; print results with text(value).
Globals:
- tools.<name>(args): call a tool. Resolves to its structured result, or its text; rejects with an Error on failure.
- text(value): append output; strings as-is, other values as JSON.
- image(value): append an image from a base64 data: URL, { image_url } or { type: "image", data, mimeType }.
- notify(value): show a progress message to the user; it is not part of your output.
- yield_control(): return control to you now; the cell keeps running and wait collects the rest.
- exit(): end the cell successfully.
- store(key, value) / load(key): keep JSON values across cells in this conversation; store(key, undefined) deletes.
- setTimeout(fn, ms) / clearTimeout(id).
- ALL_TOOLS: [{ name, description, usage }] for every tool callable from cells.
The cell ends when its top-level code settles; pending timers and unawaited calls are dropped. If it is still running after yield_time_ms, the result says so with its cell ID: call wait with that cell_id near the expected completion, or terminate it. Tool calls already made are not undone by errors or termination.`;

/**
 * @param {{ listed?: Array<{ tool: any, guidelines: string[] }>, unlisted?: any[] }} [tools]
 */
export function buildExecDescription(tools = {}) {
	const { listed = [], unlisted = [] } = tools;
	const entries = [];
	const overflow = [];
	let used = 0;
	for (const { tool, guidelines } of listed) {
		const entry = renderEntry(tool, guidelines);
		if (used + entry.length > LISTING_BUDGET_CHARS) overflow.push(tool);
		else {
			entries.push(entry);
			used += entry.length + 1;
		}
	}
	const sections = [EXEC_INTRO];
	if (entries.length > 0) sections.push(`Tools available in exec:\n${entries.join("\n")}`);
	const more = [...overflow, ...unlisted].map((tool) => `tools.${toIdentifier(tool.name)}`);
	if (more.length > 0)
		sections.push(
			`More tools, not described here (read ALL_TOOLS.find(t => t.name === "NAME") before calling): ${clip(more.join(", "), 4000)}`,
		);
	return sections.join("\n\n");
}

export const WAIT_DESCRIPTION = `Wait for more output from a running exec cell, or terminate it. Pass the cell_id from exec. yield_time_ms (default ${DEFAULT_WAIT_YIELD_MS}) is how long to wait before returning while the cell keeps running; repeated waits on a busy cell wait longer. max_tokens limits the returned output. terminate: true stops the cell.`;

/** Which tools an exec call may reach, for extensions that register tools lazily (MCP). */
export function reachesTools(input) {
	const code = input?.code;
	if (typeof code !== "string") return [];
	return /\bALL_TOOLS\b/.test(code) ? "all" : [...new Set(code.match(/[A-Za-z0-9_$]+/g) ?? [])];
}

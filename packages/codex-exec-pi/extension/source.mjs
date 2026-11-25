// Parsing of `exec` input: an optional `// @exec: {...}` options line followed by JavaScript.

export const EXEC_PRAGMA_PREFIX = "// @exec:";

/** Lark grammar for providers that constrain freeform tool input (OpenAI custom tools). */
export const EXEC_GRAMMAR = String.raw`start: with_options | source_only
with_options: OPTIONS_LINE NEWLINE SOURCE
source_only: SOURCE

OPTIONS_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

const OPTION_FIELDS = new Set(["yield_time_ms", "max_output_tokens"]);
const FENCE = /^\s*```(?:javascript|js|typescript|ts)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/;

export class ExecSourceError extends Error {
	constructor(message) {
		super(message);
		this.name = "ExecSourceError";
	}
}

function integerOption(options, name, minimum) {
	const value = options[name];
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < minimum)
		throw new ExecSourceError(`exec option ${name} must be an integer >= ${minimum}`);
	return value;
}

/**
 * @param {unknown} input
 * @returns {{ source: string, yieldTimeMs?: number, maxOutputTokens?: number }}
 */
export function parseExecSource(input) {
	if (typeof input !== "string") throw new ExecSourceError("exec expects JavaScript source text");
	// Models occasionally wrap the cell in a markdown fence despite the description.
	let text = FENCE.exec(input)?.[1] ?? input;
	const newline = text.search(/\r?\n/);
	const firstLine = newline === -1 ? text : text.slice(0, newline);
	let options = {};
	if (firstLine.trimStart().startsWith(EXEC_PRAGMA_PREFIX)) {
		const json = firstLine.trimStart().slice(EXEC_PRAGMA_PREFIX.length).trim();
		try {
			options = JSON.parse(json);
		} catch {
			throw new ExecSourceError(`exec options line is not valid JSON: ${json}`);
		}
		if (options === null || typeof options !== "object" || Array.isArray(options))
			throw new ExecSourceError("exec options must be a JSON object");
		for (const key of Object.keys(options))
			if (!OPTION_FIELDS.has(key)) throw new ExecSourceError(`Unsupported exec option: ${key}`);
		// Keep an empty first line so reported line numbers match the input.
		text = newline === -1 ? "" : `\n${text.slice(newline).replace(/^\r?\n/, "")}`;
		if (text.trim() === "") throw new ExecSourceError("exec options line must be followed by JavaScript source");
	}
	if (text.trim() === "") throw new ExecSourceError("exec requires JavaScript source");
	const result = { source: text };
	const yieldTimeMs = integerOption(options, "yield_time_ms", 0);
	const maxOutputTokens = integerOption(options, "max_output_tokens", 1);
	if (yieldTimeMs !== undefined) result.yieldTimeMs = yieldTimeMs;
	if (maxOutputTokens !== undefined) result.maxOutputTokens = maxOutputTokens;
	return result;
}

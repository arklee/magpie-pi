// apply_patch: parsing and application of Codex-format patches.
//
// Ported from pi-apply-patch src/index.ts and src/write-file-atomic.ts
// (MIT, Copyright (c) 2026 Yeongyu Kim; see licenses/pi-apply-patch.LICENSE and NOTICE).
// The patch language and grammar mirror OpenAI Codex `codex-rs/apply-patch`.
// Rendering was not ported; the Pi integration lives in ../index.ts.

import { mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { replacementsAroundContext, SourceText } from "./line-endings.mjs";

export const APPLY_PATCH_DESCRIPTION =
	"Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.";

export const APPLY_PATCH_LARK_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

export class PatchParseError extends Error {
	constructor(message) {
		super(message);
		this.name = "PatchParseError";
	}
}

export class PatchApplicationError extends Error {
	constructor(message) {
		super(message);
		this.name = "PatchApplicationError";
	}
}

function hasErrorCode(error, code) {
	return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

/** Accepts `{ input }` or the bare patch string, as older sessions and cells pass it. */
export function normalizeApplyPatchArguments(args) {
	if (typeof args === "string") return { input: args };
	if (args && typeof args === "object" && typeof args.input === "string") return { input: args.input };
	return { input: "" };
}

function normalizePatchText(patchText) {
	return patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripHeredoc(input) {
	const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
	return heredocMatch ? (heredocMatch[2] ?? input) : input;
}

function normalizeSeekLine(line) {
	return line
		.trim()
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[“”„‟]/g, '"')
		.replace(/[  -   　]/g, " ");
}

/** Finds `pattern` in `lines`, trying exact, trailing-space, trimmed and punctuation-normalized matches. */
function seekSequence(lines, pattern, start, eof) {
	if (pattern.length === 0) return { index: start, fuzz: 0 };
	if (pattern.length > lines.length) return undefined;
	const searchStart = eof && lines.length >= pattern.length ? lines.length - pattern.length : start;
	const lastStart = lines.length - pattern.length;
	const passes = [
		[(line) => line, 0],
		[(line) => line.trimEnd(), 1],
		[(line) => line.trim(), 100],
		[normalizeSeekLine, 10000],
	];
	for (const [prepare, fuzz] of passes) {
		const preparedLines = fuzz === 0 ? lines : lines.map(prepare);
		const preparedPattern = fuzz === 0 ? pattern : pattern.map(prepare);
		for (let index = searchStart; index <= lastStart; index++) {
			let matched = true;
			for (let offset = 0; offset < preparedPattern.length; offset++) {
				if (preparedLines[index + offset] !== preparedPattern[offset]) {
					matched = false;
					break;
				}
			}
			if (matched) return { index, fuzz };
		}
	}
	return undefined;
}

const FILE_HEADER_MARKERS = [
	["add", "*** Add File: "],
	["delete", "*** Delete File: "],
	["update", "*** Update File: "],
];
const MOVE_TO_MARKER = "*** Move to: ";

function parseFileHeader(line) {
	const trimmed = line.trim();
	for (const [kind, marker] of FILE_HEADER_MARKERS) {
		if (trimmed.startsWith(marker)) return { kind, path: trimmed.slice(marker.length) };
	}
	return undefined;
}

function parseMoveTo(line) {
	const trimmed = line.trimEnd();
	return trimmed.startsWith(MOVE_TO_MARKER) ? trimmed.slice(MOVE_TO_MARKER.length) : undefined;
}

/** Every path a patch names, including move targets, for display and permission prompts. */
export function extractPatchedPaths(patchText) {
	const lines = stripHeredoc(normalizePatchText(patchText)).split("\n");
	return lines.flatMap((line) => {
		const found = parseFileHeader(line)?.path ?? parseMoveTo(line.trimStart());
		return found === undefined ? [] : [found];
	});
}

export function parsePatch(patchText) {
	const normalized = stripHeredoc(normalizePatchText(patchText).trim()).trim();
	const lines = normalized.split("\n");
	const beginIndex = lines[0]?.trim() === "*** Begin Patch" ? 0 : -1;
	const endIndex = lines[lines.length - 1]?.trim() === "*** End Patch" ? lines.length - 1 : -1;
	if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex)
		throw new PatchParseError("Invalid patch format: expected *** Begin Patch ... *** End Patch envelope");

	const hunks = [];
	let index = beginIndex + 1;
	while (index < endIndex) {
		// Like Codex, file headers are recognized after trimming, and any other non-blank line between file
		// sections is rejected below; skipping it would silently drop the section it introduces.
		const line = (lines[index] ?? "").trim();
		if (line === "") {
			index++;
			continue;
		}
		const header = parseFileHeader(line);

		if (header?.kind === "add") {
			index++;
			const contentLines = [];
			while (index < endIndex) {
				const nextLine = lines[index] ?? "";
				if (nextLine.trim().startsWith("*** ")) break;
				if (!nextLine.startsWith("+")) throw new PatchParseError("Invalid patch format: Add File lines must start with '+'");
				contentLines.push(nextLine.slice(1));
				index++;
			}
			hunks.push({ type: "add", filePath: header.path, content: contentLines.length === 0 ? "" : `${contentLines.join("\n")}\n` });
			continue;
		}

		if (header?.kind === "delete") {
			hunks.push({ type: "delete", filePath: header.path });
			index++;
			continue;
		}

		if (header?.kind === "update") {
			const filePath = header.path;
			index++;
			let movePath;
			const moveTo = parseMoveTo(lines[index] ?? "");
			if (moveTo !== undefined) {
				movePath = moveTo;
				index++;
			}

			const chunks = [];
			while (index < endIndex) {
				const nextLine = lines[index] ?? "";
				if (nextLine.trim() === "") {
					index++;
					continue;
				}
				if (nextLine.startsWith("*** ")) break;

				const allowMissingContext = chunks.length === 0;
				const changeContexts = [];
				if (nextLine.startsWith("@@")) {
					while (index < endIndex) {
						const contextLine = lines[index] ?? "";
						if (contextLine === "@@") {
							index++;
							continue;
						}
						if (contextLine.startsWith("@@ ")) {
							changeContexts.push(contextLine.slice("@@ ".length));
							index++;
							continue;
						}
						break;
					}
				} else if (!allowMissingContext) {
					throw new PatchParseError(`Expected update hunk to start with a @@ context marker, got: '${nextLine}'`);
				}

				const oldLines = [];
				const newLines = [];
				const contextLineIndices = [];
				let isEndOfFile = false;
				let parsedLines = 0;
				while (index < endIndex) {
					const hunkLine = lines[index] ?? "";
					if (hunkLine === "*** End of File") {
						if (parsedLines === 0) throw new PatchParseError("Update hunk does not contain any lines");
						isEndOfFile = true;
						index++;
						break;
					}
					if (hunkLine.startsWith("@@") || hunkLine.startsWith("*** ")) break;
					const prefix = hunkLine[0];
					const value = hunkLine.slice(1);
					if (prefix === undefined) {
						contextLineIndices.push([oldLines.length, newLines.length]);
						oldLines.push("");
						newLines.push("");
					} else if (prefix === " ") {
						contextLineIndices.push([oldLines.length, newLines.length]);
						oldLines.push(value);
						newLines.push(value);
					} else if (prefix === "-") {
						oldLines.push(value);
					} else if (prefix === "+") {
						newLines.push(value);
					} else if (parsedLines > 0) {
						break;
					} else {
						throw new PatchParseError(
							`Unexpected line found in update hunk: '${hunkLine}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
						);
					}
					parsedLines++;
					index++;
				}
				if (parsedLines === 0) throw new PatchParseError("Update hunk does not contain any lines");
				chunks.push({ changeContexts, oldLines, newLines, contextLineIndices, isEndOfFile });
			}
			if (chunks.length === 0 && !movePath) throw new PatchParseError(`Update file hunk for path '${filePath}' is empty`);
			hunks.push(movePath !== undefined ? { type: "update", filePath, movePath, chunks } : { type: "update", filePath, chunks });
			continue;
		}

		throw new PatchParseError(
			`'${line}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
		);
	}
	return hunks;
}

export function parseNonEmptyPatch(patchText) {
	const hunks = parsePatch(patchText);
	if (hunks.length > 0) return hunks;
	if (normalizePatchText(patchText).trim() === "*** Begin Patch\n*** End Patch")
		throw new PatchParseError("patch rejected: empty patch");
	throw new PatchParseError("apply_patch verification failed: no hunks found");
}

function replaceChunks(content, filePath, chunks) {
	const source = SourceText.parse(content);
	const originalLines = source.texts;
	const replacements = [];
	let lineIndex = 0;
	let fuzz = 0;
	for (const chunk of chunks) {
		for (const changeContext of chunk.changeContexts) {
			const contextMatch = seekSequence(originalLines, [changeContext], lineIndex, false);
			if (contextMatch === undefined) throw new PatchApplicationError(`Failed to find context '${changeContext}' in ${filePath}`);
			fuzz += contextMatch.fuzz;
			lineIndex = contextMatch.index + 1;
		}
		if (chunk.oldLines.length === 0) {
			const insertionIndex = originalLines[originalLines.length - 1] === "" ? originalLines.length - 1 : originalLines.length;
			replacements.push({ start: insertionIndex, oldLength: 0, newLines: chunk.newLines });
			continue;
		}
		let pattern = chunk.oldLines;
		let newLines = chunk.newLines;
		let foundAt = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		if (foundAt === undefined && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newLines[newLines.length - 1] === "") newLines = newLines.slice(0, -1);
			foundAt = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		}
		if (foundAt === undefined)
			throw new PatchApplicationError(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
		fuzz += foundAt.fuzz;
		replacements.push(...replacementsAroundContext(foundAt.index, pattern.length, newLines, chunk.contextLineIndices));
		lineIndex = foundAt.index + pattern.length;
	}
	return { content: source.replace(replacements), fuzz };
}

export async function writeFileAtomic(absolutePath, content) {
	const tempPath = `${absolutePath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
	await writeFile(tempPath, content, "utf-8");
	try {
		await rename(tempPath, absolutePath);
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) {
			await unlink(tempPath).catch(() => {});
			throw error;
		}
		await unlink(absolutePath);
		await rename(tempPath, absolutePath);
	}
}

async function canonicalMutationPath(filePath) {
	try {
		return await realpath(filePath);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return path.resolve(filePath);
		throw error;
	}
}

/** Runs `operation` while holding Pi's per-file mutation queue for every path, in a fixed order. */
async function withMutationQueues(queue, filePaths, operation) {
	const canonical = await Promise.all(filePaths.map(canonicalMutationPath));
	const sorted = [...new Set(canonical)].sort((left, right) => left.localeCompare(right));
	const run = (index) => {
		const filePath = sorted[index];
		return filePath === undefined ? operation() : queue(filePath, () => run(index + 1));
	};
	return run(0);
}

const runDirectly = (_filePath, operation) => operation();

async function applySingleHunk(cwd, hunk, queue) {
	const absolutePath = path.resolve(cwd, hunk.filePath);
	const absoluteMovePath = hunk.type === "update" && hunk.movePath ? path.resolve(cwd, hunk.movePath) : undefined;
	const mutationPaths = absoluteMovePath ? [absolutePath, absoluteMovePath] : [absolutePath];
	return withMutationQueues(queue, mutationPaths, async () => {
		if (hunk.type === "add") {
			await mkdir(path.dirname(absolutePath), { recursive: true });
			await writeFileAtomic(absolutePath, hunk.content);
			return { summary: `add: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: 0 };
		}
		if (hunk.type === "delete") {
			await stat(absolutePath);
			await rm(absolutePath);
			return { summary: `delete: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: 0 };
		}
		const currentContent = await readFile(absolutePath, "utf-8");
		const chunkResult =
			hunk.chunks.length === 0 ? { content: currentContent, fuzz: 0 } : replaceChunks(currentContent, hunk.filePath, hunk.chunks);
		if (hunk.movePath && absoluteMovePath) {
			await mkdir(path.dirname(absoluteMovePath), { recursive: true });
			await writeFileAtomic(absoluteMovePath, chunkResult.content);
			if (absoluteMovePath !== absolutePath) await rm(absolutePath);
			return { summary: `move: ${hunk.filePath} -> ${hunk.movePath}`, appliedFile: hunk.movePath, fuzz: chunkResult.fuzz };
		}
		await writeFileAtomic(absolutePath, chunkResult.content);
		return { summary: `update: ${hunk.filePath}`, appliedFile: hunk.filePath, fuzz: chunkResult.fuzz };
	});
}

function createRecoveryInstructions({ appliedFiles, failures }) {
	// ENOENT, EACCES, ENOTDIR and similar are not context mismatches; rereading does not fix them.
	const mustReadFiles = [...new Set(failures.filter((failure) => failure.code === undefined).map((failure) => failure.filePath))];
	const mustRead = new Set(mustReadFiles);
	return {
		mustReadFiles,
		mustNotReadFiles: [...new Set(appliedFiles.filter((filePath) => !mustRead.has(filePath)))],
		failedFiles: [...new Set(failures.map((failure) => failure.filePath))],
	};
}

/**
 * Applies parsed hunks in order. A failing hunk is recorded and later hunks still run, as in Codex.
 * @param {{ queue?: (filePath: string, operation: () => Promise<any>) => Promise<any>, onProgress?: (progress: { applied: number, failed: number, total: number }) => void }} [options]
 */
export async function applyHunks(cwd, hunks, options = {}) {
	const { queue = runDirectly, onProgress } = options;
	const summaries = [];
	const appliedFiles = [];
	const failures = [];
	let fuzz = 0;
	for (const hunk of hunks) {
		try {
			const result = await applySingleHunk(cwd, hunk, queue);
			summaries.push(result.summary);
			appliedFiles.push(result.appliedFile);
			fuzz += result.fuzz;
		} catch (error) {
			const code = error && typeof error === "object" && typeof error.code === "string" ? error.code : undefined;
			failures.push({ filePath: hunk.filePath, operation: hunk.type, message: error instanceof Error ? error.message : String(error), code });
		}
		try {
			onProgress?.({ applied: appliedFiles.length, failed: failures.length, total: hunks.length });
		} catch {
			// Progress rendering must not affect patch application.
		}
	}
	return {
		summaries,
		appliedFiles,
		failures,
		hasPartialSuccess: appliedFiles.length > 0 && failures.length > 0,
		recoveryInstructions: createRecoveryInstructions({ appliedFiles, failures }),
		fuzz,
	};
}

/** @param {Parameters<typeof applyHunks>[2]} [options] */
export async function applyPatchText(cwd, patchText, options) {
	return applyHunks(cwd, parseNonEmptyPatch(patchText), options);
}

/** The model-facing text for an apply_patch result. */
export function formatApplyPatchResult(result) {
	if (result.failures.length === 0) return result.summaries.join("\n");
	const mustReadFiles = result.recoveryInstructions.mustReadFiles;
	return [
		result.hasPartialSuccess ? "apply_patch partially failed." : "apply_patch failed.",
		"Failed:",
		...result.failures.map((failure) => `- ${failure.filePath} (${failure.operation}): ${failure.message}`),
		mustReadFiles.length > 0 ? `Recovery: MUST read ${mustReadFiles.join(" and ")} before retrying.` : "",
		result.appliedFiles.length > 0 ? "Earlier file actions in this patch were already applied." : "No file actions were applied.",
		result.recoveryInstructions.mustNotReadFiles.length > 0
			? "Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it."
			: "",
	]
		.filter((line) => line.length > 0)
		.join("\n");
}

// Ported from pi-apply-patch src/line-endings.ts (MIT, Copyright (c) 2026 Yeongyu Kim).
// See licenses/pi-apply-patch.LICENSE.

/**
 * Splits a matched chunk into replacements that skip its context lines, so those source lines keep
 * their exact text and ending (Codex `compute_replacements`, PreserveLineEndings mode). Context
 * indices past the matched region belong to a trailing empty line the matcher already dropped.
 *
 * @param {number} start
 * @param {number} oldLength
 * @param {string[]} newLines
 * @param {ReadonlyArray<readonly [number, number]>} contextLineIndices
 */
export function replacementsAroundContext(start, oldLength, newLines, contextLineIndices) {
	const replacements = [];
	let oldStart = 0;
	let newStart = 0;
	for (const [oldContext, newContext] of contextLineIndices) {
		if (oldContext >= oldLength || newContext >= newLines.length) break;
		if (oldStart !== oldContext || newStart !== newContext) {
			replacements.push({
				start: start + oldStart,
				oldLength: oldContext - oldStart,
				newLines: newLines.slice(newStart, newContext),
			});
		}
		oldStart = oldContext + 1;
		newStart = newContext + 1;
	}
	if (oldStart !== oldLength || newStart !== newLines.length) {
		replacements.push({ start: start + oldStart, oldLength: oldLength - oldStart, newLines: newLines.slice(newStart) });
	}
	return replacements;
}

/**
 * A file split into lines that remember their own line ending, so an update rewrites only the lines a
 * patch touches. Mirrors Codex `codex-rs/apply-patch/src/text_file.rs`: unchanged lines keep their
 * endings, inserted lines take the file's first ending (LF when it has none), and every line ends with
 * an ending, which keeps apply_patch's trailing-newline behavior.
 */
export class SourceText {
	constructor(lines, preferredEnding) {
		this.lines = lines;
		this.preferredEnding = preferredEnding;
	}

	static parse(content) {
		const lines = [];
		let preferredEnding;
		let lineStart = 0;
		for (let cursor = 0; cursor < content.length; cursor++) {
			const character = content[cursor];
			if (character !== "\n" && character !== "\r") continue;
			const ending = character === "\r" && content[cursor + 1] === "\n" ? "\r\n" : character;
			preferredEnding ??= ending;
			lines.push({ text: content.slice(lineStart, cursor), ending });
			cursor += ending.length - 1;
			lineStart = cursor + 1;
		}
		if (lineStart < content.length) lines.push({ text: content.slice(lineStart), ending: undefined });
		return new SourceText(lines, preferredEnding ?? "\n");
	}

	get texts() {
		return this.lines.map((line) => line.text);
	}

	replace(replacements) {
		const next = [];
		let sourceIndex = 0;
		for (const { start, oldLength, newLines } of [...replacements].sort((left, right) => left.start - right.start)) {
			next.push(...this.lines.slice(sourceIndex, start));
			next.push(...newLines.map((text) => ({ text, ending: this.preferredEnding })));
			sourceIndex = start + oldLength;
		}
		next.push(...this.lines.slice(sourceIndex));
		return next.map((line) => line.text + (line.ending ?? this.preferredEnding)).join("");
	}
}

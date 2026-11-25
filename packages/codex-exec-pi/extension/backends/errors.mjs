const MAX_FRAMES = 5;
const CELL_FILE = "exec-cell.js";

/**
 * Formats an error thrown by cell code: its message (with the source excerpt V8 adds to syntax
 * errors) plus stack frames inside the cell, without host frames.
 */
export function formatGuestError(error, prefix) {
	let text;
	try {
		const stack = error !== null && typeof error === "object" ? error.stack : undefined;
		if (typeof stack === "string" && stack.length > 0) {
			const lines = stack.split("\n");
			const firstFrame = lines.findIndex((line) => /^\s+at /.test(line));
			const head = (firstFrame === -1 ? lines : lines.slice(0, firstFrame)).join("\n").trimEnd();
			const frames = (firstFrame === -1 ? [] : lines.slice(firstFrame))
				.filter((line) => line.includes(CELL_FILE))
				.slice(0, MAX_FRAMES);
			text = [head, ...frames].join("\n");
		} else if (error !== null && typeof error === "object" && typeof error.message === "string") {
			text = `${error.name ?? "Error"}: ${error.message}`;
		} else {
			text = `Uncaught ${String(error)}`;
		}
	} catch {
		text = "A value that cannot be described was thrown";
	}
	return prefix ? `${prefix}: ${text}` : text;
}

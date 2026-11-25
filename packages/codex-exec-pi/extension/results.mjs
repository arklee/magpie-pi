import { CHARS_PER_TOKEN, MAX_IMAGES_PER_RESULT, MAX_OUTPUT_TOKENS } from "./limits.mjs";

export function contentText(content) {
	return (Array.isArray(content) ? content : [])
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

/**
 * What a nested tool call resolves to inside a cell: `structuredContent` when the tool returns one,
 * otherwise its text, or its content blocks when it returned images. Failures reject, except
 * failures that still carry structured content.
 */
export function outcomeToValue(outcome) {
	const result = outcome?.result ?? {};
	const failed = outcome?.isError === true || result.isError === true;
	if (result.structuredContent !== undefined) return result.structuredContent;
	if (failed) throw new Error(contentText(result.content) || "Tool call failed");
	const content = Array.isArray(result.content) ? result.content : [];
	if (content.every((block) => block?.type === "text")) return contentText(content);
	return content.map((block) =>
		block?.type === "image" ? { type: "image", data: block.data, mimeType: block.mimeType } : block,
	);
}

function truncateText(text, maxChars) {
	if (text.length <= maxChars) return text;
	const head = Math.floor(maxChars * 0.6);
	const tail = Math.max(0, maxChars - head);
	const omitted = text.length - head - tail;
	return `${text.slice(0, head)}\n… ${omitted} characters omitted …\n${text.slice(text.length - tail)}`;
}

/** Bounds a cell's output to a token budget, keeping the start and end of the text. */
export function boundOutput(items, maxTokens) {
	const tokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(1, maxTokens));
	const maxChars = tokens * CHARS_PER_TOKEN;
	const texts = items.filter((item) => item.type === "text");
	const images = items.filter((item) => item.type === "image");
	const textLength = texts.reduce((sum, item) => sum + item.text.length + 1, 0);
	let content;
	if (textLength <= maxChars) {
		content = items.filter((item) => item.type === "text" || images.indexOf(item) < MAX_IMAGES_PER_RESULT);
	} else {
		content = [
			{ type: "text", text: truncateText(texts.map((item) => item.text).join("\n"), maxChars) },
			...images.slice(0, MAX_IMAGES_PER_RESULT),
		];
	}
	if (images.length > MAX_IMAGES_PER_RESULT)
		content.push({
			type: "text",
			text: `${images.length - MAX_IMAGES_PER_RESULT} more image(s) omitted; emit at most ${MAX_IMAGES_PER_RESULT} per result`,
		});
	return content.map((item) =>
		item.type === "image" ? { type: "image", data: item.data, mimeType: item.mimeType } : { type: "text", text: item.text },
	);
}

/**
 * Converts a cell observation into a Pi tool result.
 * @param {{ kind: "result" | "yielded" | "terminated", cellId: string, items: any[], errorText?: string }} response
 */
export function toToolResult(response, maxTokens) {
	const output = boundOutput(response.items, maxTokens);
	let status;
	if (response.kind === "yielded")
		status = `Script running with cell ID ${response.cellId}. Call wait with this cell_id near the expected completion; avoid short polling.`;
	else if (response.kind === "terminated") status = `Script terminated (cell ${response.cellId}).`;
	else if (response.errorText !== undefined) status = `Script error:\n${response.errorText}`;
	const content = output;
	if (status !== undefined) {
		// Status first for running cells so it is seen even with long output; errors go last, after output.
		if (response.kind === "result") content.push({ type: "text", text: status });
		else content.unshift({ type: "text", text: status });
	}
	if (content.length === 0) content.push({ type: "text", text: "Script completed with no output." });
	return {
		content,
		...(response.kind === "result" && response.errorText !== undefined ? { isError: true } : {}),
		details: {
			cellId: response.cellId,
			status: response.kind === "result" && response.errorText !== undefined ? "error" : response.kind === "result" ? "completed" : response.kind,
		},
	};
}

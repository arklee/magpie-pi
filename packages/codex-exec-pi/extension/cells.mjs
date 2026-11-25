// Exec cells: lifecycle, buffered output, yielding, and nested tool calls.
//
// A cell runs in its backend independently of the model. exec and wait *observe* it for a while:
// they attach an observer, collect output until the cell finishes, yields, or the yield time ends,
// and return what was produced since the previous observation.
//
// Pi only accepts nested tool calls (ctx.executeTool) while the calling tool is executing, and
// retires their IDs when it returns. So calls run under the current observer only; before an
// observation returns it stops accepting calls and waits for the ones in flight. Calls a cell makes
// while nobody observes it wait for the next exec/wait of that cell.

import {
	MAX_BUFFERED_OUTPUT_CHARS,
	MAX_LIVE_CELLS,
	MAX_REMEMBERED_CELLS,
	MAX_TOOL_RESULT_CHARS,
	MAX_YIELD_MS,
	MIN_ADAPTIVE_WAIT_MS,
} from "./limits.mjs";
import { outcomeToValue } from "./results.mjs";

const PROGRESS_LINES = 6;

/**
 * @typedef {{
 *   executeTool(name: string, args: unknown): Promise<any>,
 *   signal?: AbortSignal,
 *   onUpdate?: (text: string) => void,
 * }} ObserverScope
 * @typedef {{ kind: "result" | "yielded" | "terminated", cellId: string, items: any[], errorText?: string }} CellResponse
 */

class Cell {
	constructor(id, tools, maxOutputTokens) {
		this.id = id;
		this.tools = new Map(tools.map((tool) => [tool.name, tool]));
		this.maxOutputTokens = maxOutputTokens;
		/** @type {"running" | "done" | "terminated"} */
		this.status = "running";
		this.errorText = undefined;
		this.output = [];
		this.outputChars = 0;
		this.queue = [];
		this.observer = undefined;
		this.listeners = new Set();
		this.yieldedWaits = 0;
		this.handle = undefined;
	}

	changed() {
		for (const listener of [...this.listeners]) listener();
	}
}

export class CellManager {
	/**
	 * @param {{ backend: import("./backends/index.mjs").ExecBackend, store?: Map<string, string> }} options
	 */
	constructor({ backend, store = new Map() }) {
		this.backend = backend;
		this.store = store;
		this.cells = new Map();
		this.remembered = new Set();
		this.next = 0;
	}

	get liveCells() {
		return [...this.cells.values()].filter((cell) => cell.status === "running").map((cell) => cell.id);
	}

	/** Starts a cell; observe it with observe(). */
	start({ source, tools, maxOutputTokens }) {
		const live = this.liveCells;
		if (live.length >= MAX_LIVE_CELLS)
			throw new Error(
				`Too many running exec cells (${live.join(", ")}); wait for them to finish or terminate one before starting another`,
			);
		const cell = new Cell(String(++this.next), tools, maxOutputTokens);
		this.cells.set(cell.id, cell);
		cell.handle = this.backend.start(
			{
				source,
				tools: tools.map(({ name, exposed, description, usage }) => ({ name, exposed, description, usage })),
				store: Object.fromEntries(this.store),
			},
			{
				event: (kind, payload) => this.#event(cell, kind, payload),
				done: (error) => this.#done(cell, error),
			},
		);
		return cell;
	}

	/** The cell for a cell_id, or an explanation of why there is none. */
	lookup(cellId) {
		const cell = this.cells.get(String(cellId));
		if (cell) return { cell };
		if (this.remembered.has(String(cellId)))
			return { missing: `exec cell ${cellId} already finished and its output was returned; there is nothing to wait for` };
		return { missing: `Unknown exec cell ${cellId}; use the cell ID from the exec result` };
	}

	/** How long wait observes a cell: repeated waits on a busy cell back off to avoid short polling. */
	waitTime(cell, requestedMs) {
		// The exec that started the cell counts as its first yield; back off from the second wait on.
		const multiplier = 2 ** Math.min(Math.max(0, cell.yieldedWaits - 1), 16);
		const adaptive = Math.min(MAX_YIELD_MS, Math.max(MIN_ADAPTIVE_WAIT_MS * multiplier, requestedMs * multiplier));
		return Math.min(MAX_YIELD_MS, Math.max(requestedMs, adaptive));
	}

	/**
	 * Observes a cell for up to `ms`, running its tool calls through `scope`.
	 * @param {ObserverScope} scope
	 * @returns {Promise<CellResponse>}
	 */
	async observe(cell, ms, scope) {
		if (cell.observer) throw new Error(`exec cell ${cell.id} is already being observed`);
		const observer = { scope, pending: new Set(), closing: false, yielded: false, progress: [] };
		cell.observer = observer;
		try {
			for (const call of cell.queue.splice(0)) this.#call(cell, call);
			await new Promise((resolve) => {
				let timer;
				const finish = () => {
					clearTimeout(timer);
					cell.listeners.delete(check);
					scope.signal?.removeEventListener("abort", finish);
					resolve();
				};
				const check = () => {
					if (cell.status !== "running" || observer.yielded) finish();
				};
				timer = setTimeout(finish, Math.max(0, Math.min(ms, MAX_YIELD_MS)));
				cell.listeners.add(check);
				scope.signal?.addEventListener("abort", finish, { once: true });
				if (scope.signal?.aborted) finish();
				else check();
			});
			if (scope.signal?.aborted && cell.status === "running") await this.#kill(cell);
		} finally {
			observer.closing = true;
			while (observer.pending.size > 0) await Promise.allSettled([...observer.pending]);
			cell.observer = undefined;
		}
		const response = this.#collect(cell);
		if (response.kind === "yielded") cell.yieldedWaits++;
		return response;
	}

	/**
	 * Stops a cell and returns the output it had not reported yet.
	 * @returns {Promise<CellResponse>}
	 */
	async terminate(cell) {
		if (cell.status === "running") await this.#kill(cell);
		return this.#collect(cell);
	}

	/** Stops every cell, for session changes and shutdown. */
	async terminateAll() {
		await Promise.allSettled([...this.cells.values()].map((cell) => this.#kill(cell)));
		this.cells.clear();
	}

	async #kill(cell) {
		if (cell.status !== "running") return;
		cell.status = "terminated";
		cell.queue = [];
		cell.changed();
		await cell.handle?.terminate();
	}

	/** @returns {CellResponse} */
	#collect(cell) {
		const items = cell.output;
		cell.output = [];
		cell.outputChars = 0;
		if (cell.status === "running") return { kind: "yielded", cellId: cell.id, items };
		this.cells.delete(cell.id);
		this.remembered.add(cell.id);
		if (this.remembered.size > MAX_REMEMBERED_CELLS) this.remembered.delete(this.remembered.values().next().value);
		if (cell.status === "terminated") return { kind: "terminated", cellId: cell.id, items };
		return cell.errorText === undefined
			? { kind: "result", cellId: cell.id, items }
			: { kind: "result", cellId: cell.id, items, errorText: cell.errorText };
	}

	#push(cell, item, size) {
		if (cell.outputChars + size > MAX_BUFFERED_OUTPUT_CHARS) {
			void this.#fail(cell, `exec cell output exceeded ${MAX_BUFFERED_OUTPUT_CHARS} characters; write large data to a file with a tool instead`);
			return;
		}
		cell.outputChars += size;
		cell.output.push(item);
	}

	async #fail(cell, message) {
		if (cell.status !== "running") return;
		cell.errorText = message;
		cell.status = "done";
		cell.queue = [];
		cell.changed();
		await cell.handle?.terminate();
	}

	#progress(cell, line) {
		const observer = cell.observer;
		if (!observer?.scope.onUpdate) return;
		observer.progress.push(line);
		if (observer.progress.length > PROGRESS_LINES) observer.progress.shift();
		try {
			observer.scope.onUpdate(observer.progress.join("\n"));
		} catch {
			// Progress rendering must not affect the cell.
		}
	}

	#event(cell, kind, payload) {
		if (cell.status !== "running") return;
		switch (kind) {
			case "text":
				this.#push(cell, { type: "text", text: String(payload.text) }, String(payload.text).length);
				break;
			case "image":
				this.#push(cell, { type: "image", data: String(payload.data), mimeType: String(payload.mimeType) }, String(payload.data).length);
				break;
			case "notify":
				this.#progress(cell, String(payload.text));
				break;
			case "yield":
				if (cell.observer && !cell.observer.closing) {
					cell.observer.yielded = true;
					cell.changed();
				}
				break;
			case "store":
				if (payload.json === undefined) this.store.delete(String(payload.key));
				else this.store.set(String(payload.key), String(payload.json));
				break;
			case "call":
				this.#call(cell, { id: payload.id, name: String(payload.name), json: String(payload.json ?? "") });
				break;
		}
	}

	#done(cell, error) {
		if (cell.status !== "running") return;
		cell.status = "done";
		cell.errorText = error;
		cell.queue = [];
		cell.changed();
	}

	#arguments(cell, call) {
		const value = call.json === "" ? {} : JSON.parse(call.json);
		const stringParam = cell.tools.get(call.name)?.stringParam;
		return typeof value === "string" && stringParam ? { [stringParam]: value } : value;
	}

	#call(cell, call) {
		if (cell.status !== "running") return;
		const observer = cell.observer;
		if (!observer || observer.closing) {
			cell.queue.push(call);
			return;
		}
		this.#progress(cell, `tools.${call.name}`);
		const task = (async () => {
			let reply;
			try {
				const outcome = await observer.scope.executeTool(call.name, this.#arguments(cell, call));
				const value = outcomeToValue(outcome);
				const json = value === undefined ? "" : JSON.stringify(value);
				if (typeof json !== "string") throw new Error(`The result of ${call.name} cannot be represented as JSON`);
				if (json.length > MAX_TOOL_RESULT_CHARS)
					throw new Error(`The result of ${call.name} exceeds ${MAX_TOOL_RESULT_CHARS} characters; request less data`);
				reply = { json };
			} catch (error) {
				reply = { error: error instanceof Error ? error.message : String(error) };
			}
			if (cell.status === "running") cell.handle.reply(call.id, reply);
		})();
		observer.pending.add(task);
		void task.finally(() => observer.pending.delete(task));
	}
}

// Worker thread that runs one exec cell in a fresh node:vm context.
// Messages to the parent: { type: "event", kind, json } and a final { type: "done", error? }.
// Messages from the parent: { type: "reply", id, json?, error? }.

import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";
import { GUEST_PRELUDE } from "./prelude.mjs";
import { formatGuestError } from "./errors.mjs";

const port = parentPort;
if (!port) throw new Error("vm-worker.mjs must run in a worker thread");

let finished = false;
const timers = new Map();

function finish(error) {
	if (finished) return;
	finished = true;
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
	port.postMessage(error === undefined ? { type: "done" } : { type: "done", error });
}

// Unawaited tool calls that reject must not crash the worker; the cell result is what counts.
process.on("unhandledRejection", () => {});

let controller;
const host = Object.freeze({
	config: workerData.config,
	emit(kind, json) {
		if (!finished) port.postMessage({ type: "event", kind, json });
	},
	setTimer(id, ms) {
		if (finished) return;
		const timer = setTimeout(() => {
			timers.delete(id);
			if (finished) return;
			try {
				controller.fire(id);
			} catch (error) {
				finish(controller.isExit(error) ? undefined : formatGuestError(error, "Uncaught error in a timer callback"));
			}
		}, ms);
		timers.set(id, timer);
	},
	clearTimer(id) {
		const timer = timers.get(id);
		if (timer) clearTimeout(timer);
		timers.delete(id);
	},
});

port.on("message", (message) => {
	if (message?.type === "reply" && controller) controller.settle(message.id, message.json, message.error);
});

function run() {
	const context = vm.createContext({}, { name: "exec cell", codeGeneration: { strings: true, wasm: false } });
	controller = vm.runInContext(GUEST_PRELUDE, context, { filename: "exec-prelude.js" })(host);
	let script;
	try {
		// The wrapper adds one line; lineOffset keeps reported line numbers equal to the input's.
		script = new vm.Script(`(async () => {\n${workerData.source}\n})()`, {
			filename: "exec-cell.js",
			lineOffset: -1,
		});
	} catch (error) {
		finish(formatGuestError(error));
		return;
	}
	let promise;
	try {
		promise = script.runInContext(context);
	} catch (error) {
		finish(controller.isExit(error) ? undefined : formatGuestError(error));
		return;
	}
	Promise.resolve(promise).then(
		() => finish(),
		(error) => finish(controller.isExit(error) ? undefined : formatGuestError(error)),
	);
}

try {
	run();
} catch (error) {
	finish(formatGuestError(error, "exec could not start the cell"));
}

import { Worker } from "node:worker_threads";
import { DEFAULT_HEAP_MIB } from "../limits.mjs";

const WORKER_URL = new URL("./vm-worker.mjs", import.meta.url);

/**
 * The VM backend: one worker thread per cell, each with a fresh node:vm context and a capped heap.
 * Terminating a cell terminates its worker, which also stops synchronous loops.
 * node:vm is not a security boundary; cells run with the same trust as the agent's other tools.
 *
 * @param {{ heapMiB?: number }} [options]
 * @returns {import("./index.mjs").ExecBackend}
 */
export function createVmBackend({ heapMiB = DEFAULT_HEAP_MIB } = {}) {
	return {
		kind: "vm",
		start(input, events) {
			const worker = new Worker(WORKER_URL, {
				workerData: {
					source: input.source,
					config: JSON.stringify({ tools: input.tools, store: input.store }),
				},
				resourceLimits: {
					maxOldGenerationSizeMb: heapMiB,
					maxYoungGenerationSizeMb: Math.min(32, heapMiB),
					stackSizeMb: 4,
				},
				stdout: true,
				stderr: true,
			});
			worker.stdout.resume();
			worker.stderr.resume();
			worker.unref();
			let settled = false;
			const done = (error) => {
				if (settled) return;
				settled = true;
				events.done(error);
				void worker.terminate();
			};
			worker.on("message", (message) => {
				if (settled) return;
				if (message?.type === "done") {
					done(message.error);
					return;
				}
				if (message?.type !== "event") return;
				let payload;
				try {
					payload = JSON.parse(message.json);
				} catch {
					return;
				}
				try {
					events.event(message.kind, payload);
				} catch (error) {
					done(error instanceof Error ? error.message : String(error));
				}
			});
			worker.on("error", (error) =>
				done(
					error?.code === "ERR_WORKER_OUT_OF_MEMORY"
						? `exec cell exceeded its ${heapMiB} MiB memory limit and was stopped`
						: `exec cell crashed: ${error?.message ?? String(error)}`,
				),
			);
			worker.on("exit", () => done("exec cell stopped unexpectedly"));
			return {
				reply(id, reply) {
					if (!settled) worker.postMessage({ type: "reply", id, ...reply });
				},
				async terminate() {
					settled = true;
					await worker.terminate();
				},
			};
		},
		async close() {},
	};
}

// Execution backends for exec cells. A backend runs one cell per start() call in a fresh
// JavaScript realm and reports its events. All backends share the guest runtime in prelude.mjs,
// so cells see the same globals whichever backend runs them.

/**
 * @typedef {{ name: string, exposed: string, description: string, usage: string }} CellToolInfo
 * @typedef {{ source: string, tools: CellToolInfo[], store: Record<string, string> }} CellInput
 * @typedef {{
 *   event(kind: "text" | "image" | "notify" | "yield" | "store" | "call", payload: any): void,
 *   done(error?: string): void,
 * }} CellEvents
 * @typedef {{
 *   reply(id: number, reply: { json: string } | { error: string }): void,
 *   terminate(): Promise<void>,
 * }} CellHandle
 * @typedef {{ kind: string, start(input: CellInput, events: CellEvents): CellHandle, close(): Promise<void> }} ExecBackend
 */

import { createVmBackend } from "./vm.mjs";

export const BACKEND_ENV = "CODEX_EXEC_PI_BACKEND";
export const DEFAULT_BACKEND = "vm";

const BACKENDS = {
	vm: { available: true, create: (options) => createVmBackend(options) },
	// Planned: QuickJS compiled to WebAssembly, for runtimes where worker resource limits are not
	// enforced (Bun) and for a real sandbox. It will reuse prelude.mjs and the same events.
	quickjs: { available: false },
};

export function backendKinds() {
	return Object.keys(BACKENDS);
}

/** Resolves the configured backend name; unknown names are rejected rather than ignored. */
export function resolveBackendKind(value = process.env[BACKEND_ENV]) {
	const kind = (value ?? "").trim().toLowerCase() || DEFAULT_BACKEND;
	if (!(kind in BACKENDS))
		throw new Error(`Unknown exec backend "${kind}" in ${BACKEND_ENV}; supported: ${backendKinds().join(", ")}`);
	return kind;
}

/** @returns {ExecBackend} */
export function createBackend(kind, options) {
	const entry = BACKENDS[kind];
	if (!entry) throw new Error(`Unknown exec backend "${kind}"`);
	if (!entry.available)
		throw new Error(`The ${kind} exec backend is not implemented yet; unset ${BACKEND_ENV} or set it to "vm"`);
	return entry.create(options);
}

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionToolContext,
	ToolLoadout,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	APPLY_PATCH_DESCRIPTION,
	APPLY_PATCH_LARK_GRAMMAR,
	applyHunks,
	extractPatchedPaths,
	formatApplyPatchResult,
	normalizeApplyPatchArguments,
	parseNonEmptyPatch,
} from "./apply-patch/apply.mjs";
import { createBackend, resolveBackendKind } from "./backends/index.mjs";
import {
	buildExecDescription,
	cellTools,
	nestedTools,
	reachesTools,
	WAIT_DESCRIPTION,
} from "./catalog.mjs";
import { CellManager } from "./cells.mjs";
import { CONFIG_FILE, loadConfig, resolveEnabled, saveEnabled } from "./config.mjs";
import {
	DEFAULT_EXEC_YIELD_MS,
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_WAIT_YIELD_MS,
	MAX_OUTPUT_TOKENS,
	MAX_YIELD_MS,
} from "./limits.mjs";
import { toToolResult } from "./results.mjs";
import { EXEC_GRAMMAR, parseExecSource } from "./source.mjs";

const EXEC_TOOLS = ["exec", "wait"];
const CODEX_TOOLS = [...EXEC_TOOLS, "apply_patch"];
/** Pi's editing tools, which apply_patch replaces in Codex mode as in Codex. */
const EDIT_TOOLS = ["edit", "write"];
const FLAG = "codex-exec";

const EXEC_PARAMS = Type.Object({
	code: Type.String({ description: "JavaScript source, optionally starting with a // @exec: options line" }),
});
const WAIT_PARAMS = Type.Object({
	cell_id: Type.String({ description: "The cell ID from exec" }),
	yield_time_ms: Type.Optional(
		Type.Integer({ minimum: 0, maximum: MAX_YIELD_MS, description: `Default ${DEFAULT_WAIT_YIELD_MS}` }),
	),
	max_tokens: Type.Optional(
		Type.Integer({ minimum: 1, maximum: MAX_OUTPUT_TOKENS, description: "Output budget for this result" }),
	),
	terminate: Type.Optional(Type.Boolean({ description: "Stop the cell instead of waiting" })),
});
const APPLY_PATCH_PARAMS = Type.Object({
	input: Type.String({ description: "The entire contents of the apply_patch command" }),
});

function preview(text: string, lines: number): string {
	const all = text.split("\n");
	return all.length <= lines ? text : `${all.slice(0, lines).join("\n")}\n… ${all.length - lines} more lines`;
}

export default function codexExec(pi: ExtensionAPI) {
	let manager: CellManager | undefined;
	let backendKind: string | undefined;
	const stores = new Map<string, Map<string, string>>();

	const storeFor = (ctx: ExtensionContext) => {
		const id = ctx.sessionManager.getSessionId();
		let store = stores.get(id);
		if (!store) stores.set(id, (store = new Map()));
		return store;
	};

	const getManager = (ctx: ExtensionContext) => {
		if (!manager) {
			backendKind = resolveBackendKind();
			manager = new CellManager({ backend: createBackend(backendKind) });
		}
		manager.store = storeFor(ctx);
		return manager;
	};

	const scope = (ctx: ExtensionToolContext, signal: AbortSignal | undefined, onUpdate: ((result: any) => void) | undefined) => ({
		executeTool: (name: string, args: unknown) => ctx.executeTool(name, args, signal ? { signal } : {}),
		signal,
		onUpdate: onUpdate
			? (text: string) => onUpdate({ content: [{ type: "text", text }], details: { status: "running" } })
			: undefined,
	});

	pi.registerTool({
		name: "exec",
		label: "Exec",
		description: buildExecDescription(),
		promptSnippet: "Run JavaScript cells that compose tool calls",
		parameters: EXEC_PARAMS,
		constrainedSampling: { type: "grammar", variants: { openai_lark: EXEC_GRAMMAR } },
		prepareArguments: (args: unknown) =>
			typeof args === "string" ? { code: args } : (args as { code: string }),
		exposure: "model-only",
		defaultActive: false,
		executionMode: "sequential",
		reachesTools,
		prepareLoadout(loadout: ToolLoadout) {
			return {
				descriptions: { exec: buildExecDescription(nestedTools(loadout)) },
				// As in Codex, the model reaches every other tool through exec.
				hiddenDeclarations: loadout.declared.map((tool) => tool.name).filter((name) => !EXEC_TOOLS.includes(name)),
			};
		},
		async execute(_id, params, signal, onUpdate, ctx) {
			const parsed = parseExecSource(params.code);
			const cells = getManager(ctx);
			const maxOutputTokens = parsed.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
			const cell = cells.start({ source: parsed.source, tools: cellTools(ctx.tools), maxOutputTokens });
			const response = await cells.observe(cell, parsed.yieldTimeMs ?? DEFAULT_EXEC_YIELD_MS, scope(ctx, signal, onUpdate));
			return toToolResult(response, maxOutputTokens);
		},
		renderCall(args, theme, context) {
			const code = typeof args?.code === "string" ? args.code : "";
			const body = context.expanded ? code : preview(code, 3);
			return new Text(`${theme.fg("toolTitle", theme.bold("exec"))}${body ? `\n${theme.fg("muted", body)}` : ""}`, 0, 0);
		},
	});

	pi.registerTool({
		name: "wait",
		label: "Wait",
		description: WAIT_DESCRIPTION,
		promptSnippet: "Collect output from a running exec cell, or terminate it",
		parameters: WAIT_PARAMS,
		exposure: "model-only",
		defaultActive: false,
		executionMode: "sequential",
		async execute(_id, params, signal, onUpdate, ctx) {
			const cells = getManager(ctx);
			const found = cells.lookup(params.cell_id);
			if (!found.cell) throw new Error(found.missing);
			const { cell } = found;
			const maxTokens = params.max_tokens ?? cell.maxOutputTokens;
			if (params.terminate) return toToolResult(await cells.terminate(cell), maxTokens);
			const ms = cells.waitTime(cell, params.yield_time_ms ?? DEFAULT_WAIT_YIELD_MS);
			return toToolResult(await cells.observe(cell, ms, scope(ctx, signal, onUpdate)), maxTokens);
		},
	});

	pi.registerTool({
		name: "apply_patch",
		label: "ApplyPatch",
		description: APPLY_PATCH_DESCRIPTION,
		promptSnippet: "Apply Codex-format file patches with apply_patch",
		promptGuidelines: [
			"Use apply_patch for file edits instead of mutating files through bash, Python scripts, heredocs, or shell redirection.",
			"After apply_patch succeeds, do not re-read the edited files just to confirm the patch applied.",
		],
		parameters: APPLY_PATCH_PARAMS,
		constrainedSampling: { type: "grammar", variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR } },
		prepareArguments: normalizeApplyPatchArguments,
		defaultActive: false,
		async execute(_id, params, _signal, onUpdate, ctx) {
			const { input } = normalizeApplyPatchArguments(params);
			if (!input) throw new Error("input is required");
			const hunks = parseNonEmptyPatch(input);
			const result = await applyHunks(ctx.cwd, hunks, {
				queue: withFileMutationQueue,
				onProgress: (progress: { applied: number; failed: number; total: number }) =>
					onUpdate?.({
						content: [{ type: "text", text: `Applying patch (${progress.applied + progress.failed}/${progress.total})...` }],
						details: undefined,
					}),
			});
			return {
				content: [{ type: "text", text: formatApplyPatchResult(result) }],
				details: undefined,
				// A failed hunk is an error, so cells calling tools.apply_patch reject.
				...(result.failures.length > 0 ? { isError: true } : {}),
			};
		},
		renderCall(args, theme) {
			const input = normalizeApplyPatchArguments(args).input;
			const paths = input ? [...new Set(extractPatchedPaths(input))] : [];
			return new Text(theme.fg("toolTitle", theme.bold(`apply_patch${paths.length ? `: ${paths.join(", ")}` : ""}`)), 0, 0);
		},
	});

	const isOn = () => EXEC_TOOLS.every((name) => pi.getActiveTools().includes(name));
	const enable = () => {
		const active = pi.getActiveTools().filter((name) => !EDIT_TOOLS.includes(name));
		pi.setActiveTools([...new Set([...active, ...CODEX_TOOLS])]);
	};
	const disable = async () => {
		const active = pi.getActiveTools().filter((name) => !CODEX_TOOLS.includes(name));
		pi.setActiveTools([...new Set([...active, ...EDIT_TOOLS])]);
		await manager?.terminateAll();
	};
	const configPath = () => path.join(getAgentDir(), CONFIG_FILE);
	const desired = async (provider: string | undefined) => {
		const config = await loadConfig(configPath());
		return { ...resolveEnabled({ flag: pi.getFlag(FLAG) === true, saved: config.enabled, provider }), error: config.error };
	};
	/** Brings the mode to the flag, the saved setting or the model's default. */
	const apply = async (ctx: ExtensionContext, provider: string | undefined) => {
		const { enabled, error } = await desired(provider);
		if (error) ctx.ui.notify(`codex-exec: ${error}; following the model instead`, "warning");
		if (enabled && !isOn()) enable();
		else if (!enabled && isOn()) await disable();
	};

	pi.registerFlag(FLAG, { description: "Start with Codex-style exec mode enabled", type: "boolean", default: false });

	pi.registerCommand("codex-exec", {
		description: "Turn Codex-style exec mode on, off or back to auto, or show its status",
		getArgumentCompletions: (prefix: string) => {
			const items = ["on", "off", "auto", "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim() || "status";
			if (!["on", "off", "auto", "status"].includes(action)) {
				ctx.ui.notify("Usage: /codex-exec on | off | auto | status", "warning");
				return;
			}
			if (action !== "status") {
				try {
					await saveEnabled(configPath(), action === "auto" ? undefined : action === "on");
				} catch (error) {
					ctx.ui.notify(`codex-exec: setting not saved: ${error instanceof Error ? error.message : String(error)}`, "warning");
				}
				if (action === "on") enable();
				else if (action === "off") await disable();
				else await apply(ctx, ctx.model?.provider);
			}
			let backend = backendKind;
			try {
				backend ??= resolveBackendKind();
			} catch (error) {
				backend = `invalid (${error instanceof Error ? error.message : String(error)})`;
			}
			const { reason } = await desired(ctx.model?.provider);
			const running = manager?.liveCells ?? [];
			ctx.ui.notify(
				`Codex exec mode is ${isOn() ? "on" : "off"} (${reason}); backend ${backend}; ${running.length} running cell(s)${running.length ? `: ${running.join(", ")}` : ""}`,
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await apply(ctx, ctx.model?.provider);
	});
	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider !== event.previousModel?.provider) await apply(ctx, event.model.provider);
	});
	// Cells belong to the conversation branch that started them.
	pi.on("session_tree", async () => {
		await manager?.terminateAll();
	});
	pi.on("session_shutdown", async () => {
		await manager?.terminateAll();
		await manager?.backend.close();
		manager = undefined;
	});
}

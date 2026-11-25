// Persisted /codex-exec setting: `{ "enabled": true | false }` in codex-exec-pi.json under Pi's
// agent directory. Without a saved `enabled`, the mode follows the model's provider.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONFIG_FILE = "codex-exec-pi.json";
/** Providers whose models get exec mode when nothing is saved. */
export const AUTO_PROVIDERS = ["openai", "openai-codex"];

/**
 * @param {string} file
 * @returns {Promise<{ enabled?: boolean, error?: string, [key: string]: unknown }>}
 */
export async function loadConfig(file) {
	let text;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return {};
		return { error: `cannot read ${file}: ${error?.message ?? error}` };
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return { error: `invalid JSON in ${file}: ${error?.message ?? error}` };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: `${file} must contain a JSON object` };
	if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
		return { error: `"enabled" in ${file} must be true or false` };
	}
	return parsed;
}

/**
 * Saves `enabled` (or removes it when undefined), keeping other keys. Writes through a
 * temporary file so a crash never leaves a truncated config. Throws if the file is unreadable.
 * @param {string} file
 * @param {boolean | undefined} enabled
 */
export async function saveEnabled(file, enabled) {
	const { error, ...next } = await loadConfig(file);
	// Never overwrite a file we could not parse; the user may want what is in it.
	if (error) throw new Error(error);
	if (enabled === undefined) delete next.enabled;
	else next.enabled = enabled;
	await mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	await rename(temp, file);
}

/**
 * The state the mode should be in, and why.
 * @param {{ flag: boolean, saved: boolean | undefined, provider: string | undefined }} input
 * @returns {{ enabled: boolean, reason: string }}
 */
export function resolveEnabled({ flag, saved, provider }) {
	if (flag) return { enabled: true, reason: "--codex-exec flag" };
	if (saved !== undefined) return { enabled: saved, reason: "saved setting" };
	const enabled = provider !== undefined && AUTO_PROVIDERS.includes(provider);
	return { enabled, reason: `auto, ${provider ? `${provider} model` : "no model"}` };
}

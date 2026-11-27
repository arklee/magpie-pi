/** A Pi provider definition, as accepted by `ModelRuntime.registerProvider(id, config)`. */
export interface MagpieProvider {
	id: string;
	name: string;
	[key: string]: unknown;
}

export interface MagpieHost {
	/** State directory in use (MAGPIE_PI_STATE or ~/.local/share/magpie-pi). */
	state: string;
	configPath: string;
	providers: MagpieProvider[];
	/** Configuration or plugin-host problems; `providers` is empty when there are any. */
	errors: string[];
	/** Stop the plugin host. Safe to call more than once. */
	close(): Promise<void>;
}

/** Also sets MAGPIE_PI_EMBEDDED=1: the Pi extension stays inactive in this process. */
export function startMagpie(options?: { state?: string; bun?: string; mirror?: string }): Promise<MagpieHost>;

export const BUN_VERSION: string;
export const bunMirrors: Readonly<Record<"github" | "npmmirror" | "npmmirror-cdn", string>>;
export function bunDownloadBase(mirror?: string): string;
export function bunReady(options?: { state?: string }): Promise<boolean>;
export function prepareBun(options?: {
 state?: string;
 mirror?: string;
 onProgress?: (progress: { received: number; total?: number }) => void;
}): Promise<string>;

export function defaultState(): string;

export interface MagpiePluginEntry {
	spec?: string;
	target?: string;
	magpieManaged?: boolean;
}

export interface MagpieSearchResult {
	name: string;
	version: string;
	description?: string;
}

export class PluginManager {
	constructor(state: string, options?: { bun?: string; mirror?: string; fetcher?: typeof fetch; runner?: unknown });
	cleanup(): Promise<void>;
	search(query: string): Promise<MagpieSearchResult[]>;
	list(): Promise<MagpiePluginEntry[]>;
	/** `confirm` must resolve true for the change to happen; returns a status message. */
	mutate(action: "install" | "remove", input: string, confirm: (name: string) => Promise<boolean>): Promise<string>;
}

/** Validate a community package name with an optional exact version (aliases: cursor, workbuddy). */
export function parse(input: string): { name: string; version?: string };

// The guest-side runtime of a cell, as JavaScript source evaluated inside the cell's own realm.
//
// It is backend-neutral: it needs only a `host` object with
//   config: string                  JSON { tools: [{ name, exposed, description, usage }], store: { key: json } }
//   emit(kind: string, json: string) events: text, image, notify, yield, store, call
//   setTimer(id: number, ms: number) / clearTimer(id: number)
// and returns a controller the backend drives:
//   settle(id, json, error)  deliver a tool result ("" means undefined) or an error message
//   fire(id)                 run a timer callback
//   isExit(error)            whether a rejection came from exit()
// The VM backend evaluates it with node:vm; a QuickJS backend can evaluate the same source.

import { STORE_TOTAL_MAX_CHARS, STORE_VALUE_MAX_CHARS } from "../limits.mjs";

export const GUEST_PRELUDE = String.raw`(function (host) {
	"use strict";
	const stringify = JSON.stringify, parse = JSON.parse;
	const config = parse(host.config);
	const define = (name, value) =>
		Object.defineProperty(globalThis, name, { value, writable: false, configurable: false, enumerable: false });
	const describe = (error) => {
		try { return error instanceof Error ? error.name + ": " + error.message : String(error); }
		catch { return "A value that cannot be described was thrown"; }
	};
	const format = (value) => {
		if (typeof value === "string") return value;
		if (value instanceof Error) return describe(value);
		try {
			const json = stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() + "n" : item));
			return json === undefined ? String(value) : json;
		} catch { return String(value); }
	};
	const emit = (kind, payload) => host.emit(kind, stringify(payload));
	// V8 gives every context an inspector-only console that prints nowhere. Like Codex, cells have
	// no console: a call fails loudly instead of losing output silently.
	try { delete globalThis.console; } catch {}

	const EXIT = Object.freeze({ toString: () => "exit()" });
	let exited = false;

	const pending = new Map();
	let nextCall = 0;
	const tools = Object.create(null);
	const catalog = [];
	for (const tool of config.tools) {
		const call = (...args) => new Promise((resolve, reject) => {
			let json;
			try { json = args.length === 0 || args[0] === undefined ? "" : stringify(args[0]); }
			catch { json = undefined; }
			if (json === undefined) {
				reject(new TypeError("Arguments for tools." + tool.exposed + " must be JSON-serializable"));
				return;
			}
			const id = ++nextCall;
			pending.set(id, { resolve, reject });
			emit("call", { id, name: tool.name, json });
		});
		if (!(tool.exposed in tools)) tools[tool.exposed] = call;
		if (!(tool.name in tools)) tools[tool.name] = call;
		catalog.push(Object.freeze({ name: tool.exposed, description: tool.description, usage: tool.usage }));
	}

	const imageBlock = (value) => {
		if (value && typeof value === "object" && value.type === "image" &&
			typeof value.data === "string" && typeof value.mimeType === "string") {
			const data = value.data.startsWith("data:") ? value.data.slice(value.data.indexOf(",") + 1) : value.data;
			if (/^[A-Za-z0-9+/=\s]+$/.test(data)) return { data: data.replace(/\s/g, ""), mimeType: value.mimeType };
		}
		const url = typeof value === "string" ? value : value && typeof value === "object" ? value.image_url : undefined;
		const match = typeof url === "string" ? /^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(url) : null;
		if (!match) throw new TypeError("image() expects a base64 data: URL, { image_url } or { type: \"image\", data, mimeType }; remote URLs are not supported");
		return { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s/g, "") };
	};

	const stored = new Map(Object.entries(config.store));
	const storeSize = (except) => {
		let size = 0;
		for (const [key, json] of stored) if (key !== except) size += key.length + json.length;
		return size;
	};

	const timers = new Map();
	let nextTimer = 0;

	define("tools", Object.freeze(tools));
	define("ALL_TOOLS", Object.freeze(catalog));
	define("text", (value) => { emit("text", { text: format(value) }); });
	define("image", (value) => { emit("image", imageBlock(value)); });
	define("notify", (value) => { emit("notify", { text: format(value) }); });
	define("yield_control", () => { emit("yield", {}); });
	define("exit", () => { exited = true; throw EXIT; });
	define("store", (key, value) => {
		if (typeof key !== "string") throw new TypeError("store key must be a string");
		let json;
		if (value !== undefined) {
			try { json = stringify(value); } catch { json = undefined; }
			if (json === undefined) throw new TypeError("store expects a JSON-serializable value");
			if (json.length > ${STORE_VALUE_MAX_CHARS}) throw new RangeError("Stored value is too large; store less data");
			if (storeSize(key) + key.length + json.length > ${STORE_TOTAL_MAX_CHARS})
				throw new RangeError("The store is full; delete keys with store(key, undefined)");
			stored.set(key, json);
		} else stored.delete(key);
		emit("store", json === undefined ? { key } : { key, json });
	});
	define("load", (key) => {
		if (typeof key !== "string") throw new TypeError("load key must be a string");
		const json = stored.get(key);
		return json === undefined ? undefined : parse(json);
	});
	define("setTimeout", (callback, delay, ...args) => {
		if (typeof callback !== "function") throw new TypeError("setTimeout expects a function");
		const id = ++nextTimer;
		timers.set(id, () => callback(...args));
		const ms = Number(delay);
		host.setTimer(id, Number.isFinite(ms) ? Math.min(Math.max(0, ms), 2147483647) : 0);
		return id;
	});
	define("clearTimeout", (id) => { if (timers.delete(id)) host.clearTimer(id); });

	return Object.freeze({
		settle(id, json, error) {
			const request = pending.get(id);
			if (!request) return;
			pending.delete(id);
			if (typeof error === "string") request.reject(new Error(error));
			else request.resolve(json === "" || json === undefined ? undefined : parse(json));
		},
		fire(id) {
			const callback = timers.get(id);
			if (!callback) return;
			timers.delete(id);
			callback();
		},
		isExit(error) { return error === EXIT || exited; },
	});
})`;

import {createHash, randomUUID} from "node:crypto";
import {chmod, lstat, mkdir, readdir, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import * as zlib from "node:zlib";

export const BUN_VERSION = "1.4.2";
// Explicit download sources; every source is checked against the pinned SHA-256 sums below.
export const bunMirrors = Object.freeze({
 github: "https://github.com/oven-sh/bun/releases/download",
 npmmirror: "https://registry.npmmirror.com/-/binary/bun",
 "npmmirror-cdn": "https://cdn.npmmirror.com/binaries/bun",
});

export function bunDownloadBase(value = process.env.MAGPIE_PI_BUN_MIRROR) {
 const input = value?.trim() || "github";
 const base = Object.hasOwn(bunMirrors, input) ? bunMirrors[input] : input;
 let url;
 try { url = new URL(base); }
 catch { throw Error(`MAGPIE_PI_BUN_MIRROR must be ${Object.keys(bunMirrors).join(", ")} or an HTTPS base URL`); }
 if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
  throw Error("MAGPIE_PI_BUN_MIRROR must be an HTTPS base URL without credentials, query or fragment");
 return url.href.replace(/\/+$/, "");
}

const sumsByZip = Object.freeze({
 "bun-darwin-aarch64.zip": "90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f",
 "bun-darwin-x64.zip": "80520d7e17526308c9185d261679ac6d27798d3803a0e9f7ff9121ab8affb012",
 "bun-linux-aarch64.zip": "54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7",
 "bun-linux-x64-baseline.zip": "c678040f14fe0440eb839d37cbd0ce4c051a32da72806ac97de6a6aab6bf728f",
 "bun-linux-aarch64-musl.zip": "71760b6c8ea30623b81a4907cb815d48e2ea266f2e73e751534a44a0607950df",
 "bun-linux-x64-musl-baseline.zip": "76e1db84e98f22f78de0a87e309bfbbf297732847f9720db36750646c85c8c18",
 "bun-windows-x64-baseline.zip": "78c221c2376f79731ccf4e4af0b3bb46d81fefa3296c5abee09ad8a1b21e68c6",
 "bun-windows-aarch64.zip": "a7a16b876a305fd1029c66dbd27007b4f6112ae896532f675878731a21e50cfd",
});
const pending = new Map();
const sizeLimit = 200 * 1024 * 1024;
const executable = process.platform === "win32" ? "bun.exe" : "bun";

export function bunTarget({platform, arch, musl}) {
 if (!["darwin", "linux", "win32"].includes(platform) || !["x64", "arm64"].includes(arch))
  throw Error(`Bun has no build for ${platform}/${arch}`);
 const cpu = arch === "arm64" ? "aarch64" : arch;
 if (platform === "darwin") return "bun-darwin-" + cpu;
 return "bun-" + (platform === "win32" ? "windows" : "linux") + "-" + cpu
  + (platform === "linux" && musl ? "-musl" : "") + (arch === "x64" ? "-baseline" : "");
}

export function managedBunPath(state) {
 return path.join(state, "bun", BUN_VERSION, executable);
}

async function regularFile(file) {
 try { return (await lstat(file)).isFile(); }
 catch (err) { if (err.code === "ENOENT") return false; throw err; }
}

async function download(url, fetcher) {
 const res = await fetcher(url, {signal: AbortSignal.timeout(600000)});
 if (!res.ok || Number(res.headers.get("content-length")) > sizeLimit) {
  await res.body?.cancel();
  throw Error(res.ok ? "download exceeds 200 MiB" : "HTTP " + res.status);
 }
 const chunks = [];
 let bytes = 0;
 for await (const chunk of res.body) {
  bytes += chunk.length;
  if (bytes > sizeLimit) throw Error("download exceeds 200 MiB");
  chunks.push(chunk);
 }
 return Buffer.concat(chunks, bytes);
}

function zip32(value) {
 if (value === 0xffffffff) throw Error("ZIP64 is unsupported");
 return value;
}

function extract(zip) {
 let end = zip.length - 22;
 const limit = Math.max(0, zip.length - 65557);
 while (end >= limit && (zip.readUInt32LE(end) !== 0x06054b50 ||
        end + 22 + zip.readUInt16LE(end + 20) !== zip.length)) end--;
 if (end < limit) throw Error("missing ZIP end record");
 const count = zip.readUInt16LE(end + 10);
 if (count === 0xffff) throw Error("ZIP64 is unsupported");
 const size = zip32(zip.readUInt32LE(end + 12));
 let entry = zip32(zip.readUInt32LE(end + 16));
 if (entry + size !== end) throw Error("invalid ZIP directory size");
 let result;
 for (let i = 0; i < count; i++) {
  if (entry + 46 > end || zip.readUInt32LE(entry) !== 0x02014b50) throw Error("invalid ZIP directory entry");
  const compressed = zip32(zip.readUInt32LE(entry + 20));
  const length = zip32(zip.readUInt32LE(entry + 24));
  const local = zip32(zip.readUInt32LE(entry + 42));
  const nameLength = zip.readUInt16LE(entry + 28);
  const name = zip.toString("utf8", entry + 46, entry + 46 + nameLength);
  const next = entry + 46 + nameLength + zip.readUInt16LE(entry + 30) + zip.readUInt16LE(entry + 32);
  if (next > end) throw Error("truncated ZIP directory");
  if (name.split("/").pop() === executable && !(zip.readUInt32LE(entry + 38) & 0x10)) {
   if (result) throw Error("duplicate Bun executable");
   if (zip.readUInt32LE(local) !== 0x04034b50) throw Error("invalid ZIP local header");
   zip32(zip.readUInt32LE(local + 18));
   zip32(zip.readUInt32LE(local + 22));
   const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
   if (start + compressed > end - size) throw Error("truncated ZIP data");
   const data = zip.subarray(start, start + compressed);
   switch (zip.readUInt16LE(entry + 10)) {
    case 0: result = data; break;
    case 8: result = zlib.inflateRawSync(data, {maxOutputLength: Math.max(1, length)}); break;
    default: throw Error("unsupported ZIP compression");
   }
   if (result.length !== length || (zlib.crc32 && zlib.crc32(result) !== zip.readUInt32LE(entry + 16)))
    throw Error("invalid Bun entry size or CRC-32");
  }
  entry = next;
 }
 if (!result || entry !== end) throw Error("invalid Bun archive");
 return result;
}

async function install(exe, target, base, sums, fetcher) {
 const archive = target + ".zip";
 const url = `${base}/bun-v${BUN_VERSION}/${archive}`;
 let zip;
 try { zip = await download(url, fetcher); }
 catch (err) { throw Error(`download ${url} failed: ${err.message ?? err}${err.cause?.message ? ": " + err.cause.message : ""}`); }
 if (createHash("sha256").update(zip).digest("hex") !== sums[archive]) throw Error("SHA-256 checksum mismatch");
 const binary = extract(zip);
 const dir = path.dirname(exe);
 const root = path.dirname(dir);
 for (const directory of [root, dir]) {
  await mkdir(directory, {recursive: true, mode: 0o700});
  if (!(await lstat(directory)).isDirectory()) throw Error("invalid Bun directory");
 }
 const part = exe + "." + process.pid + "." + randomUUID() + ".part";
 try {
  await writeFile(part, binary, {mode: 0o755, flag: "wx"});
  await chmod(part, 0o755);
  try { await rename(part, exe); }
  catch (err) { if (!await regularFile(exe)) throw err; }
 } finally { await rm(part, {force: true}); }
 for (const other of await readdir(root, {withFileTypes: true}).catch(() => [])) {
  if (other.isDirectory() && /^\d+\.\d+\.\d+$/.test(other.name) && other.name !== BUN_VERSION)
   await rm(path.join(root, other.name), {recursive: true, force: true}).catch(() => {});
 }
 return exe;
}

export async function ensureBun(state, {fetcher = fetch, override = process.env.MAGPIE_PI_BUN,
 base, target, sums = sumsByZip} = {}) {
 if (override) return override;
 const exe = managedBunPath(state);
 try {
  if (await regularFile(exe)) return exe;
  target ??= bunTarget({platform: process.platform, arch: process.arch,
   musl: process.platform === "linux" && !process.report?.getReport?.()?.header?.glibcVersionRuntime});
  if (!pending.has(exe)) {
   pending.set(exe, install(exe, target, base ?? bunDownloadBase(), sums, fetcher).finally(() => pending.delete(exe)));
  }
  return await pending.get(exe);
 } catch (err) {
  throw Error(`magpie-pi: could not get Bun ${BUN_VERSION} (${target ?? process.platform + "/" + process.arch}): ${err.message ?? err}. Set MAGPIE_PI_BUN_MIRROR to download from a mirror, or MAGPIE_PI_BUN to use a Bun executable you have.`);
 }
}

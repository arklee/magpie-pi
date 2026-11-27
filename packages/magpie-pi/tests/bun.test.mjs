import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, stat} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {deflateRawSync} from "node:zlib";
import {BUN_VERSION, bunDownloadBase, bunTarget, bunReady, ensureBun, managedBunPath} from "../extension/bun.mjs";

test("Bun release targets", () => {
 for (const [platform, arch, musl, expected] of [
  ["darwin", "x64", false, "bun-darwin-x64"],
  ["darwin", "arm64", false, "bun-darwin-aarch64"],
  ["linux", "x64", false, "bun-linux-x64-baseline"],
  ["linux", "arm64", false, "bun-linux-aarch64"],
  ["linux", "x64", true, "bun-linux-x64-musl-baseline"],
  ["linux", "arm64", true, "bun-linux-aarch64-musl"],
  ["win32", "x64", false, "bun-windows-x64-baseline"],
  ["win32", "arm64", false, "bun-windows-aarch64"],
 ]) assert.equal(bunTarget({platform, arch, musl}), expected);
 for (const [platform, arch] of [["linux", "ia32"], ["android", "arm64"]])
  assert.throws(() => bunTarget({platform, arch}), {message: `Bun has no build for ${platform}/${arch}`});
});

const binary = Buffer.from("fixture bun");
function fixtureZip(name, method) {
 const filename = Buffer.from(name);
 const data = method === 8 ? deflateRawSync(binary) : binary;
 const local = Buffer.alloc(30);
 local.writeUInt32LE(0x04034b50);
 local.writeUInt16LE(method, 8);
 local.writeUInt32LE(0x273ee66d, 14); // CRC-32 of "fixture bun".
 local.writeUInt32LE(data.length, 18);
 local.writeUInt32LE(binary.length, 22);
 local.writeUInt16LE(filename.length, 26);
 const central = Buffer.alloc(46);
 central.writeUInt32LE(0x02014b50);
 local.copy(central, 6, 4, 28);
 const end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50);
 end.writeUInt16LE(1, 8);
 end.writeUInt16LE(1, 10);
 end.writeUInt32LE(central.length + filename.length, 12);
 end.writeUInt32LE(local.length + filename.length + data.length, 16);
 return Buffer.concat([local, filename, data, central, filename, end]);
}

async function fixture(t, method = 8) {
 const state = await mkdtemp(path.join(os.tmpdir(), "magpie-bun-"));
 t.after(() => rm(state, {recursive: true, force: true}));
 const exe = managedBunPath(state);
 const target = "fixture-target";
 const zip = fixtureZip(target + "/" + path.basename(exe), method);
 let calls = 0;
 const options = {override: "", target, base: "https://fixture.invalid",
  sums: {[target + ".zip"]: createHash("sha256").update(zip).digest("hex")},
  fetcher: async (url, {signal}) => {
   calls++;
   assert.ok(signal instanceof AbortSignal);
   assert.equal(url, `https://fixture.invalid/bun-v${BUN_VERSION}/${target}.zip`);
   return new Response(new ReadableStream({start(c){c.enqueue(zip.subarray(0,5));c.enqueue(zip.subarray(5));c.close();}}), {headers:{"content-length":String(zip.length)}});
  }};
 return {state, exe, options, size:zip.length, calls: () => calls};
}

for (const method of [0, 8]) test("installs and reuses Bun, ZIP method " + method, async t => {
 const {state, exe, options, calls} = await fixture(t, method);
 const root = path.join(state, "bun");
 await mkdir(path.join(root, "1.3.14"), {recursive: true});
 assert.equal(await ensureBun(state, options), exe);
 assert.deepEqual(await readFile(exe), binary);
 if (process.platform !== "win32") assert.equal((await stat(exe)).mode & 0o777, 0o755);
 assert.deepEqual(await readdir(root), [BUN_VERSION]);
 assert.equal(await ensureBun(state, options), exe);
 assert.equal(calls(), 1);
});

test("checksum failure leaves no executable or parts and allows retry", async t => {
 const {state, exe, options} = await fixture(t);
 await mkdir(path.dirname(exe), {recursive: true});
 await assert.rejects(ensureBun(state, {...options, sums: {}}), /checksum mismatch/);
 assert.deepEqual(await readdir(path.dirname(exe)), []);
 assert.equal(await ensureBun(state, options), exe);
});

test("HTTP failure names the URL and includes override instructions", async t => {
 const {state, options} = await fixture(t);
 await assert.rejects(ensureBun(state, {...options, fetcher: () => new Response(null, {status: 503})}),
  /could not get Bun 1\.4\.2 \(fixture-target\): download https:\/\/fixture\.invalid\/bun-v1\.4\.2\/fixture-target\.zip failed: HTTP 503\. Set MAGPIE_PI_BUN_MIRROR .* MAGPIE_PI_BUN /);
 await assert.rejects(ensureBun(state, {...options, fetcher: () => { throw new TypeError("fetch failed", {cause: Error("ETIMEDOUT")}); }}),
  /fixture-target\.zip failed: fetch failed: ETIMEDOUT\./);
});

test("Bun download mirrors", () => {
 assert.equal(bunDownloadBase(undefined), "https://github.com/oven-sh/bun/releases/download");
 assert.equal(bunDownloadBase(" "), "https://github.com/oven-sh/bun/releases/download");
 assert.equal(bunDownloadBase("github"), "https://github.com/oven-sh/bun/releases/download");
 assert.equal(bunDownloadBase("npmmirror"), "https://registry.npmmirror.com/-/binary/bun");
 assert.equal(bunDownloadBase("npmmirror-cdn"), "https://cdn.npmmirror.com/binaries/bun");
 assert.equal(bunDownloadBase(" https://example.com/bun/// "), "https://example.com/bun");
 for (const value of ["unknown", "http://example.com", "https://user:pass@example.com",
  "https://example.com/?x=1", "https://example.com/#x"])
  assert.throws(() => bunDownloadBase(value), /MAGPIE_PI_BUN_MIRROR must be/);
});

test("mirror from the environment is used and still checksum-verified", async t => {
 const {state, options} = await fixture(t);
 const saved = process.env.MAGPIE_PI_BUN_MIRROR;
 t.after(() => { if (saved === undefined) delete process.env.MAGPIE_PI_BUN_MIRROR; else process.env.MAGPIE_PI_BUN_MIRROR = saved; });
 process.env.MAGPIE_PI_BUN_MIRROR = "npmmirror";
 const urls = [];
 const {base, ...rest} = options;
 await assert.rejects(ensureBun(state, {...rest, fetcher: async url => { urls.push(url); return new Response("tampered"); }}),
  /checksum mismatch/);
 assert.deepEqual(urls, [`https://registry.npmmirror.com/-/binary/bun/bun-v${BUN_VERSION}/fixture-target.zip`]);
 process.env.MAGPIE_PI_BUN_MIRROR = "http://insecure.invalid";
 await assert.rejects(ensureBun(state, rest), /MAGPIE_PI_BUN_MIRROR must be an HTTPS/);
 await assert.rejects(ensureBun(state, {...rest, mirror:"invalid"}), /must be/);
 assert.equal(await ensureBun(state, {...rest, mirror:base}), managedBunPath(state));
 assert.equal(await ensureBun(state, {...rest, override: "custom bun"}), "custom bun");
});

test("concurrent requests share one download", async t => {
 const {state, exe, options, calls} = await fixture(t);
 const paths = await Promise.all(Array.from({length: 8}, () => ensureBun(state, options)));
 assert.deepEqual(paths, Array(8).fill(exe));
 assert.equal(calls(), 1);
});

test("explicit override bypasses download", async t => {
 const {state, options, calls} = await fixture(t);
 assert.equal(await ensureBun(state, {...options, override: "custom bun"}), "custom bun");
 assert.equal(calls(), 0);
});

test("installation reports bytes and makes Bun ready for embedding", async t => {
 const {state, exe, options, size} = await fixture(t);
 assert.equal(await bunReady(state, {override:""}), false);
 assert.equal(await bunReady(state, {override:"custom"}), true);
 const progress = [];
 await ensureBun(state, {...options,onProgress(p){progress.push(p);throw Error("observer");}});
 assert.deepEqual(progress, [{received:5,total:size},{received:size,total:size}]);
 assert.equal(await bunReady(state, {override:""}), true);
 const embed = await import("../extension/embed.mjs");
 assert.equal(await embed.bunReady({state}), true);
 assert.equal(await embed.prepareBun({state}), process.env.MAGPIE_PI_BUN || exe);
});

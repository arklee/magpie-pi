import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {supervisorPath} from "../extension/platform.mjs";

test("selects all six packaged supervisor binaries", () => {
 for (const [platform, os] of [["linux","linux"],["darwin","darwin"],["win32","windows"]]) {
  for (const [arch, cpu] of [["x64","amd64"],["arm64","arm64"]]) {
   assert.equal(supervisorPath("root", platform, arch), path.join("root", "bin", `magpie-pi-${os}-${cpu}${platform === "win32" ? ".exe" : ""}`));
  }
 }
});

test("rejects unsupported platforms and architectures explicitly", () => {
 for (const [platform, arch] of [["freebsd","x64"],["linux","ia32"],["linux","riscv64"],["toString","x64"],["linux","constructor"]]) {
  assert.throws(() => supervisorPath("root", platform, arch), /unsupported platform/);
 }
});

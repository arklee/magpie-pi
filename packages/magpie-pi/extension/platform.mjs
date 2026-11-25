import path from "node:path";

export function supervisorPath(root, platform = process.platform, arch = process.arch) {
 const os = {linux:"linux", darwin:"darwin", win32:"windows"}[platform];
 const cpu = {x64:"amd64", arm64:"arm64"}[arch];
 if (!os || !cpu || !["linux", "darwin", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) {
  throw new Error(`magpie-pi: unsupported platform ${platform}/${arch}; supported: Linux, macOS, Windows on x64 or arm64`);
 }
 return path.join(root, "bin", `magpie-pi-${os}-${cpu}${platform === "win32" ? ".exe" : ""}`);
}

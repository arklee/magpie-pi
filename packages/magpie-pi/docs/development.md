# Development and release notes

Build, validation, and release information for maintainers. See [AGENTS.md](../AGENTS.md) for architecture, extraction, lifecycle, and plugin-state safety requirements.

## Source builds and validation

**For source users and maintainers only; npm package users can skip this section.**

Source checkouts do not include supervisor binaries. In addition to runtime dependencies, building requires **Go 1.23+** and Node.js:

```sh
git clone https://github.com/arklee/magpie-pi.git
cd magpie-pi/packages/magpie-pi
node scripts/build.mjs
pi install .
```

Plugin installation and host startup share the pinned Bun in `state/bun/<version>/`. Checksums and platform targets are in `extension/bun.mjs`. Set `MAGPIE_PI_BUN` to use a local executable offline, or `MAGPIE_PI_BUN_MIRROR` to pick a download source (presets in `bunMirrors`; no automatic fallback between sources).

Rebuild after Go source changes. Restart Pi after extension or host changes. For development dependencies, use the exact peer dependency versions in `package.json`.

Validation:

```sh
node scripts/extraction.mjs
node scripts/build.mjs
npm test
bun test tests/provider.test.ts
npm run typecheck
go vet ./...
go test ./...
```

Before npm packaging, run `node scripts/build.mjs --all` to build all six platform binaries, then `npm pack --dry-run` to inspect the package. Cross-compilation does not establish runtime support.

## Monorepo workflow

This package lives in `packages/magpie-pi`. Its version, Go module, dependencies,
build artifacts and npm publish whitelist remain independent of other plugins.
From the repository root, run `npm run check --workspace magpie-pi` for all checks,
or `npm run build:all --workspace magpie-pi` for cross-builds. Root `npm test`
delegates to workspace test scripts; it does not include Bun provider tests.

Install development dependencies with `npm install` from the repository root.
Do not replace a pre-existing node_modules symlink to a Pi installation without
checking its ownership and purpose. Package scripts execute in the package directory.
The upstream checkout formerly at `../magpie` relative to the repository is now
`../../../magpie` relative to this package; extraction still requires an explicit path.

Run `npm pack --dry-run` and `npm publish` only from this package directory after
release validation and explicit publication authorization. Use independent release
tags such as `magpie-pi/v0.1.2`; do not version or publish the private root package.

See [PLAN.md](../PLAN.md) for implementation status. `extraction.json` records upstream provenance and hashes; do not hand-edit generated `vendor/` files.

## Compatibility and verification status

- Third-party plugins run with your user privileges. Installation scripts are disabled, but runtime code is **not sandboxed**.
- Real Cursor/WorkBuddy accounts remain unverified. Successful installation does not establish service compatibility.
- Exposes Chat Completions models from `@ai-sdk/openai-compatible` and Messages models from `@ai-sdk/anthropic`. The Chat path has fixture coverage; the Anthropic path remains unverified. Responses/Gemini and ambiguous `@ai-sdk/openai` models are not supported.
- Magpie's built-in Codex, Claude, Copilot, and Gemini account implementations are not included.
- Only Linux runtime behavior has been verified. Prebuilt binaries also cover macOS and Windows, on x64 and arm64.
- Displayed costs of 0 mean pricing is unavailable, not that service is free.

If a service is missing from `/login`, restart Pi and check startup errors. If no models appear, the plugin may not expose a supported protocol.

Embedders can check `bunReady({state})` and call `prepareBun({state, mirror, onProgress})` to receive byte counts during installation. Both `startMagpie` and `PluginManager` accept an explicit mirror.

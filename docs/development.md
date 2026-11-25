# Development and release notes

Build, validation, and release information for maintainers. See [AGENTS.md](../AGENTS.md) for architecture, extraction, lifecycle, and plugin-state safety requirements.

## Source builds and validation

**For source users and maintainers only; npm package users can skip this section.**

Source checkouts do not include supervisor binaries. In addition to runtime dependencies, building requires **Go 1.23+** and Node.js:

```sh
git clone https://github.com/arklee/magpie-pi.git
cd magpie-pi
node scripts/build.mjs
pi install .
```

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

See [PLAN.md](../PLAN.md) for implementation status. `extraction.json` records upstream provenance and hashes; do not hand-edit generated `vendor/` files.

## Compatibility and verification status

- Third-party plugins run with your user privileges. Installation scripts are disabled, but runtime code is **not sandboxed**.
- Real Cursor/WorkBuddy accounts remain unverified. Successful installation does not establish service compatibility.
- Exposes Chat Completions models from `@ai-sdk/openai-compatible` and Messages models from `@ai-sdk/anthropic`. The Chat path has fixture coverage; the Anthropic path remains unverified. Responses/Gemini and ambiguous `@ai-sdk/openai` models are not supported.
- Magpie's built-in Codex, Claude, Copilot, and Gemini account implementations are not included.
- Only Linux runtime behavior has been verified. Prebuilt binaries also cover macOS and Windows, on x64 and arm64.
- Displayed costs of 0 mean pricing is unavailable, not that service is free.

If a service is missing from `/login`, restart Pi and check startup errors. If no models appear, the plugin may not expose a supported protocol.


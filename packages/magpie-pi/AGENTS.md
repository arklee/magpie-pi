# Agent guidelines

## Purpose and boundaries

This project extracts magpie's service integration capabilities for use in Pi.
Read `README.md` and `PLAN.md` before making changes; distinguish implemented
features from planned work and real-vendor compatibility from fixture coverage.

- Keep the Go executable small. Do not translate Go implementations into TypeScript.
- Do not import the full magpie application, GUI, gateway, routing or statistics stack.
- Integrate through Pi extensions and provider APIs, not a Pi core fork.
- Preserve coexistence with Pi's built-in providers and reuse pi-ai protocol implementations.
- Use stdio RPC; do not introduce a listening HTTP gateway for convenience.
- User-facing menus, prompts, errors and status messages must be in English.

## Architecture

- `main.go`: small Go supervisor for the Bun host, private state and child lifecycle.
- `vendor/host.js`: pinned upstream OpenCode plugin host; Bun executes community plugins.
- `extension/bridge.mjs`: RPC, streaming responses, credit flow and cancellation.
- `extension/index.ts`: startup, provider registration, authentication and model integration.
- `extension/plugins.mjs`: plugin discovery, transactional installation, deferred cleanup
  and native Pi TUI menus.
- `scripts/`: reproducible extraction and platform builds.
- `tests/`: local fixtures, lifecycle, provider, plugin-management and menu tests.

The Go supervisor is not yet an extraction of all magpie built-in account providers.
Do not describe community-plugin installation as proof of service compatibility.

## Upstream extraction

`extraction.json` records the source commit, file hashes and patch metadata.
Never hand-edit generated `vendor/` files. Preserve upstream license provenance.
If a patch becomes necessary, implement a reproducible patch step and validation
instead of making an undocumented change to the copied output.

Before changing extraction scope, read the source repository's `AGENTS.md`,
`LESSONS.md`, code standards and relevant subsystem references, and verify the
referenced implementation. The usual sibling checkout is `../../../magpie`
from this package directory (`../magpie` from the monorepo root).

```sh
node scripts/extraction.mjs                       # verify extracted hashes
node scripts/extraction.mjs extract /path/to/magpie # explicitly update from HEAD
```

Review extracted diffs and rerun tests after updates. Do not modify the upstream
checkout as a side effect of building or testing this project.

## Pi integration

Check `package.json` for the supported Pi version. Inspect installed Pi package
contents, documentation and types before using extension APIs; do not guess their
contracts. The current development installation is under
`~/.pi/agent/install/releases/1.6.0/node_modules/@earendil-works/`.

Use native `ctx.ui.select`, `input` and `confirm` for interactive management.
Escape must cancel without mutations. Commands must remain available with no
configured providers and when a plugin fails to initialize.

Preserve stream cancellation, bounded response buffering, terminal error handling,
tool calls and authentication semantics. Pi logout must not be bypassed by cached
plugin credentials. Keep ordinary logs free of secrets.

## Plugin installation and state safety

- Default state is `~/.local/share/magpie-pi`; `MAGPIE_PI_STATE` overrides it.
- Tests must use temporary state, mocked registry/installer operations or fixtures.
  Never install real plugins or edit the user's Pi configuration as a test side effect.
- Search metadata without executing package code. Require explicit interactive
  confirmation before installation or removal; reject unconfirmed noninteractive mutations.
- Validate package names and exact versions. Use argument arrays, not shell interpolation.
- Keep npm install scripts disabled; explain that runtime plugins still have user privileges.
- Do not offer the withdrawn Antigravity auth plugin to new users; agy-cli is distinct.
- Preserve atomic config writes, mutation locking, rollback and unrelated config fields.
- Never overwrite manually configured plugins or delete paths outside owned managed stages.
- Deferred deletion requires validated ownership and symlink/path checks. Preserve credentials.
- Do not claim live unloading: changes require restarting Pi. Shared-state instances
  must all exit before restarting for deferred cleanup.

## Validation

Run from `packages/magpie-pi` (the package root):

```sh
node scripts/extraction.mjs
node scripts/build.mjs
npm test
bun test tests/provider.test.ts
npm run typecheck
go vet ./...
go test ./...
```

`node scripts/build.mjs --all` cross-builds the supported platform targets; this
does not establish runtime support on those platforms. Go currently relies mainly
on integration tests rather than Go unit tests. Typechecking currently covers the
extension entry point with JavaScript checking disabled; do not overstate coverage.

Add regression tests for changed behavior, including failures and cancellation.
Report which checks actually ran. Real-vendor and live-terminal verification are
separate from mocked-menu and fixture tests.

## Repository hygiene

Keep both READMEs focused on installation, basic usage, configuration, and licensing.
Put source-build, testing, npm packaging, protocol/lifecycle, and detailed compatibility
notes in `docs/development.md`, this file, or PLAN.md rather than the user README.
Retain concise user-facing trust and unverified-service notices without duplicating
the developer compatibility matrix. See `docs/development.md` for build/release steps.

Keep `bin/`, `node_modules`, credentials and machine-specific configuration out of
commits. The local `node_modules` may be a symlink to Pi's installation.
Update README/PLAN when supported scope or workflows change. Do not publish,
push, change global Pi settings or install into user state unless requested.

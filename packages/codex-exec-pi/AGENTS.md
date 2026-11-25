# Agent guidelines

## Purpose and boundaries

This package gives Pi a Codex-style tool surface without native binaries: `exec`/`wait` code mode
and `apply_patch`. Read `README.md`, `PLAN.md` and `docs/development.md` before changing it.

- No Rust, Go or other native executables, and no runtime downloads.
- Integrate only through Pi's public extension API (`registerTool`, `prepareLoadout`,
  `ctx.executeTool`, events, commands); no Pi core fork or internal imports.
- Keep the model-facing contract stable: tool names, parameters, grammars, globals and result
  wording. Changing them changes how models behave; update tests and docs together.
- User-facing messages, descriptions and errors are in English.

## Architecture

- `extension/index.ts`: Pi integration. Registers `exec`, `wait`, `apply_patch`, the
  `/codex-exec` command and the `--codex-exec` flag; owns session lifecycle.
- `extension/config.mjs`: saved `/codex-exec` setting and the flag/setting/provider precedence.
- `extension/cells.mjs`: cell lifecycle, buffered output, yielding, nested-call scoping.
- `extension/catalog.mjs`: exec/wait descriptions and the nested tool listing.
- `extension/source.mjs`: `// @exec:` options line and the exec grammar.
- `extension/results.mjs`: tool outcome → cell value; cell observation → Pi tool result.
- `extension/backends/`: cell runtimes. `prelude.mjs` is the backend-neutral guest runtime;
  `vm.mjs` + `vm-worker.mjs` implement the `vm` backend; `index.mjs` selects backends and
  reserves `quickjs`.
- `extension/apply-patch/`: port of pi-apply-patch's parser and applier.

Only `index.ts` may import Pi packages. Everything else is plain Node ESM so the worker and the
tests run without Pi's loader. Files the worker imports must stay `.mjs`: Node does not strip
TypeScript types under `node_modules`.

## Invariants

- Nested tool calls run only while an `exec`/`wait` call observes the cell; an observation drains
  its in-flight calls before returning (Pi retires nested-call IDs when the outer call returns).
- Every cell gets a fresh realm. Nothing but `store()` values crosses cells.
- Terminate, abort, session tree navigation and shutdown stop cells; never leave workers running.
- Values cross the realm boundary as JSON strings, so guest code never sees host-realm objects.
- Tool calls are real; never retry them automatically.

## Upstream provenance

`extension/apply-patch/` derives from pi-apply-patch (MIT). Keep the attribution headers,
`NOTICE` and `licenses/pi-apply-patch.LICENSE`. The patch language and grammar mirror Codex;
keep them compatible unless intentionally updating against Codex.

## Validation

Run from this package directory:

```sh
npm test
CODEX_EXEC_TEST_PI=~/.pi/agent/bin/pi node --test tests/pi-loader.test.mjs
npm run typecheck
```

`tests/pi-sdk.test.mjs` drives a real Pi SDK session with Pi's faux model. The loader test is
skipped unless `CODEX_EXEC_TEST_PI` names a Pi executable. Report which checks actually ran;
real-model and live-terminal behavior are verified separately.

Do not publish, push, change global Pi settings or install into user state unless requested.

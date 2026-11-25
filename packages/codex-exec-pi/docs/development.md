# Development notes

See [AGENTS.md](../AGENTS.md) for boundaries and invariants and [PLAN.md](../PLAN.md) for status.

## Design

### Model-facing surface

The aim is Codex's code-mode interface for GPT models, without Codex's Rust code-mode host:

| | Codex / pi-codex-conversion Code | codex-exec-pi |
| --- | --- | --- |
| Runtime | V8 in OpenAI's code-mode host binary | V8 through `node:vm` in a worker thread |
| Tools the model sees | `exec`, `wait` | `exec`, `wait` (others hidden via `prepareLoadout`) |
| Cell state | fresh per cell, `store`/`load` | same |
| Output | `text()`, `image()`; values discarded; no console | same |
| Long cells | yield after `yield_time_ms`, resume with `wait` | same, adaptive wait back-off |
| Nested tools | Codex tools (`exec_command`, `apply_patch`, ...) | Pi's tools plus `apply_patch` |

Compared with Pi's built-in `codemode` (QuickJS): cells are not async function bodies whose
`return` is printed, there is no `console`, `models` or tool search, timers exist, and long cells
yield instead of running to completion. Those are deliberate Codex behaviors.

`exec` takes `{ code }` with an OpenAI Lark grammar, so providers with grammar-constrained tools
send raw source. `apply_patch` takes `{ input }` with Codex's patch grammar. Tools with one
required string parameter can be called positionally from cells (`tools.apply_patch(patch)`).

### Cells and observations

`CellManager` (`cells.mjs`) owns cells. A cell runs on its own; `exec` and `wait` *observe* it:

1. Attach an observer and start the cell's queued tool calls.
2. Wait until the cell finishes, calls `yield_control()`, the yield time passes, or the call is
   aborted (abort terminates the cell).
3. Stop accepting new calls, wait for the observer's in-flight calls, detach.
4. Return the output produced since the previous observation.

Step 3 exists because Pi assigns nested calls the ID `<parent>/<n>` and retires them when the
parent tool returns. A cell's calls made between observations wait in its queue for the next one.

The worker runs the cell's JavaScript while the host thread is free, so even a synchronous loop
yields on time and `terminate` stops it by terminating the worker.

### Backends

`backends/index.mjs` selects a backend by `CODEX_EXEC_PI_BACKEND` (default `vm`). A backend
implements:

```ts
interface ExecBackend {
  kind: string;
  start(input: { source: string; tools: CellToolInfo[]; store: Record<string, string> },
        events: { event(kind, payload): void; done(error?: string): void }): {
    reply(id: number, reply: { json: string } | { error: string }): void;
    terminate(): Promise<void>;
  };
  close(): Promise<void>;
}
```

`backends/prelude.mjs` is the guest runtime as JavaScript source. It needs only a `host` object
(`config`, `emit`, `setTimer`, `clearTimer`) and returns a controller (`settle`, `fire`,
`isExit`). All values cross as JSON strings, so a backend needs no object marshalling.

### Planned QuickJS backend

The `vm` backend has two gaps: Bun does not enforce worker memory limits, and `node:vm` is not a
sandbox. A `quickjs` backend (QuickJS compiled to WebAssembly, for example `quickjs-emscripten`
or the `quickjs-wasi` build Pi bundles) would close both. Plan:

- Run QuickJS in a worker thread as now, so yielding and hard termination keep working.
- Evaluate `GUEST_PRELUDE` unchanged; implement `host.emit`/`setTimer`/`clearTimer` as host
  functions and drive the job queue (`executePendingJobs`) after each reply and timer.
- Use QuickJS memory limits and interrupt handlers for heap caps and cancellation.
- Keep `formatGuestError`'s output shape (message, `exec-cell.js:<line>` frames).
- Register it in `BACKENDS` with `available: true`; run `tests/cells.test.mjs` against both
  backends (parameterize the backend kind).

Expect differences in error wording and speed (no JIT); the model-facing contract must not change.

## Validation

```sh
npm test
CODEX_EXEC_TEST_PI=~/.pi/agent/bin/pi node --test tests/pi-loader.test.mjs
npm run typecheck
```

From the repository root: `npm run check --workspace codex-exec-pi`. Typecheck covers
`extension/index.ts` against installed Pi types; `.mjs` modules are not strictly checked.

## Release

Independent of other packages. Tag as `codex-exec-pi/v<version>`. Run `npm pack --dry-run` from
this directory and inspect the file list before any publish; publish only when explicitly asked.
The package is `UNLICENSED` until a license is chosen; `NOTICE` and `licenses/` must ship.

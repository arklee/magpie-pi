# Implementation plan

1. [x] Study pi-codex-conversion's Code/VM Code/TS Notebook modes, Pi's codemode and the Pi 1.6.0
   extension API (`prepareLoadout`, `ctx.executeTool`, `exposure`, `constrainedSampling`).
2. [x] `exec`/`wait` with Codex's interface: freeform source with a Lark grammar, `// @exec:`
   options, yielding cells, adaptive waits, terminate.
3. [x] `vm` backend: one worker thread and fresh `node:vm` context per cell, heap limit, timers,
   hard termination, backend-neutral guest prelude.
4. [x] Nested tools through Pi's executor with per-observation scoping; other tools hidden from
   the model while `exec` is active and listed in its description.
5. [x] `apply_patch` ported from pi-apply-patch, usable directly and from cells.
6. [x] `/codex-exec on|off|status`, `--codex-exec` flag.
7. [x] Unit tests, VM runtime tests, Pi SDK end-to-end test with the faux model, loader test.
8. [ ] `quickjs` backend (see docs/development.md).
9. [ ] Real GPT/Codex model sessions and interactive TUI rendering checks.

## Not implemented

- `quickjs` backend. `CODEX_EXEC_PI_BACKEND=quickjs` reports that it is not available.
- Codex's `exec_command`/`write_stdin` tools; cells call Pi's own tools (`bash`, `read`, ...).
- Persisting `store()` values in the session; they live in memory for the Pi process.
- apply_patch diff previews in the TUI (pi-apply-patch renders them; this port shows paths).
- Memory limits under Bun (worker `resourceLimits` are not enforced there).

## Verification

- `npm test`: 42 tests, including VM runtime and Pi SDK end-to-end tests (Node 26.13.1).
- Loader test against the installed Pi 1.6.0: passed.
- `npm run typecheck`: passed (entry point; `.mjs` files are not strictly checked).
- Under Bun 1.4.5 the vm backend runs cells; a 32 MiB heap limit was not enforced.
- Not verified: real models, interactive TUI, Windows, Node 22.

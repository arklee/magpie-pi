# codex-exec-pi

[中文](README.zh-CN.md)

Codex-style tools for [Pi](https://github.com/earendil-works/pi), with no native binaries:

- **`exec` / `wait`**: the model writes JavaScript cells that call Pi's tools, the way Codex's code
  mode works. Long cells yield and are resumed with `wait`. Other tools are reached only through
  cells, so GPT models see the interface they know from Codex.
- **`apply_patch`**: Codex-format file patches, usable directly or from cells.

Requires Pi 1.6.0 and Node.js 22.19 or newer.

## Installation

```sh
pi install npm:codex-exec-pi
```

Do not enable it together with another extension that registers `exec`, `wait` or `apply_patch`,
such as pi-codex-conversion in a code mode or pi-apply-patch.

## Usage

Turn the mode on in a session:

```text
/codex-exec on
```

This activates `exec`, `wait` and `apply_patch` and deactivates `edit` and `write`. While `exec` is
active, every other active tool is hidden from the model and listed in the `exec` description as
`tools.<name>(...)`. `/codex-exec off` restores `edit` and `write`; `/codex-exec status` shows
the state and what decided it.

By default the mode follows the model: it turns on for `openai` and `openai-codex` models and off
for others, including when you switch models in a session. `/codex-exec on` and `/codex-exec off`
are remembered for later sessions in `~/.pi/agent/codex-exec-pi.json` (`{ "enabled": true }`), and
then apply to every model; `/codex-exec auto` forgets the setting and follows the model again.
`pi --codex-exec` turns the mode on for that run regardless.

The mode overrides `exec`/`wait` in Pi's `defaultTools`; use the commands above instead. To use
only `apply_patch`, enable it alone with `"defaultTools": ["+apply_patch"]` and
`/codex-exec off`.

## What cells can do

Each `exec` call runs in a fresh JavaScript context with top-level `await`. Cells call tools with
`tools.read({ path })`, print with `text()`, and can use `image()`, `notify()`, `store()`/`load()`,
`setTimeout()`, `yield_control()` and `exit()`. They have no Node APIs, imports, network or
console; anything external goes through Pi's tools, with Pi's normal permission checks and hooks.

A cell that runs past its yield time (30 seconds by default) keeps running; the model collects
the rest with `wait`. Cells stop when the session ends or the conversation tree is navigated.
`store()` values last for the Pi process and are not saved to disk.

Tool calls made by a cell are real: errors and termination do not undo them.

## Configuration

| Environment variable | Meaning |
| --- | --- |
| `CODEX_EXEC_PI_BACKEND` | Cell runtime. `vm` (default) runs cells in Node.js worker threads. A `quickjs` runtime is planned and not available yet. |

The `vm` runtime limits each cell's heap to 256 MiB under Node.js. Under Bun, worker memory limits
are not enforced. It is not a security sandbox: cells run with the same trust as the agent's other
tools.

## License

Not yet licensed for redistribution (`UNLICENSED`). `apply_patch` is ported from
[pi-apply-patch](https://github.com/code-yeongyu/pi-apply-patch) under the MIT license; see
[NOTICE](NOTICE) and [licenses/](licenses/).

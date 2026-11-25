# codex-exec-pi

[English](README.md)

为 [Pi](https://github.com/earendil-works/pi) 提供 Codex 风格的工具，不依赖任何原生二进制：

- **`exec` / `wait`**：模型编写调用 Pi 工具的 JavaScript cell，工作方式与 Codex 的 code mode
  相同。运行较久的 cell 会让出控制，之后用 `wait` 继续收集结果。其他工具只能通过 cell 调用，
  GPT 系列模型看到的是它在 Codex 中熟悉的界面。
- **`apply_patch`**：Codex 格式的文件补丁，可以直接调用，也可以在 cell 中调用。

需要 Pi 1.6.0 与 Node.js 22.19 或更高版本。

## 安装

```sh
pi install npm:codex-exec-pi
```

不要与其他注册 `exec`、`wait` 或 `apply_patch` 的扩展同时启用，例如处于 code 模式的
pi-codex-conversion，或 pi-apply-patch。

## 使用

在会话中开启：

```text
/codex-exec on
```

这会启用 `exec`、`wait` 和 `apply_patch`，并停用 `edit` 和 `write`。`exec` 启用期间，其他所有
已启用的工具都对模型隐藏，改为以 `tools.<name>(...)` 的形式列在 `exec` 的说明中。
`/codex-exec off` 会恢复 `edit` 和 `write`；`/codex-exec status` 显示当前状态。

若希望每个会话都以此模式启动，可以运行 `pi --codex-exec`，或在 Pi 的 `settings.json` 中加入：

```json
{
  "defaultTools": ["+exec", "+wait", "+apply_patch", "-edit", "-write"]
}
```

只想使用 `apply_patch` 时，单独启用它即可：`"defaultTools": ["+apply_patch"]`。

## cell 能做什么

每次 `exec` 都在全新的 JavaScript 上下文中运行，支持顶层 `await`。cell 通过
`tools.read({ path })` 调用工具，用 `text()` 输出，还可以使用 `image()`、`notify()`、
`store()`/`load()`、`setTimeout()`、`yield_control()` 和 `exit()`。cell 中没有 Node API、
import、网络访问和 console；一切外部操作都通过 Pi 的工具完成，照常经过 Pi 的权限检查和 hook。

超过让出时间（默认 30 秒）的 cell 会继续运行，模型用 `wait` 收集剩余输出。会话结束或在会话树中
切换分支时，cell 会被停止。`store()` 的值在 Pi 进程存活期间有效，不会写入磁盘。

cell 发出的工具调用是真实执行的：出错或终止都不会撤销它们。

## 配置

| 环境变量 | 含义 |
| --- | --- |
| `CODEX_EXEC_PI_BACKEND` | cell 运行时。`vm`（默认）在 Node.js worker 线程中运行 cell。`quickjs` 运行时已在计划中，目前尚不可用。 |

在 Node.js 下，`vm` 运行时把每个 cell 的堆限制在 256 MiB；在 Bun 下，worker 的内存限制不生效。
它不是安全沙箱：cell 与 agent 的其他工具具有相同的信任级别。

## 许可

尚未授权再分发（`UNLICENSED`）。`apply_patch` 移植自
[pi-apply-patch](https://github.com/code-yeongyu/pi-apply-patch)，采用 MIT 许可；见
[NOTICE](NOTICE) 与 [licenses/](licenses/)。

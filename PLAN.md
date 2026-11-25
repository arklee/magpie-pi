# Implementation plan

1. [x] Inspect upstream design, licensing, plugin host and installed Pi 1.6.0 APIs.
2. [x] Extract pinned host with SHA-256 manifest, verification/update script and MIT provenance.
3. [x] Build small Go stdio supervisor; separate 0700 state; child shutdown; no listener.
4. [x] Thin native Pi provider extension, SDK fetch injection, discovery, auth forms and account selection.
5. [x] Deterministic actual Go/Bun fixture integration: login, models, text, tools, 512 KiB response credit flow, abort, credential mode and restart persistence. Separate Pi SDK integration confirms text/toolCall events.
6. [x] Chinese README, explicit scope and limitations, local packaging, six cross-builds.

Verification completed:
- node --test tests/*.test.mjs: 3 passed (includes terminal exit, failed launch close, response cancellation).
- bun test tests/provider.test.ts: 1 passed.
- go vet ./...: passed.
- go test -race ./... under temporary HOME and pinned caches: passed (no Go unit test files).
- extraction SHA-256 verification: passed.
- Linux/macOS/Windows amd64+arm64 builds: passed; only Linux executed.
- Linux amd64 stripped supervisor: 2,007,200 bytes.
- magpie git status remained clean.

Remaining scope (not advertised as implemented):
- Real vendor login/requests and full community-plugin compatibility matrix.
- Anthropic fixture integration, Responses/Gemini support, accurate pricing.
- Built-in subscription extraction, GUI/migrations, routing/quotas/rotation.
- Plugin credential deletion (Pi logout now disables resolution through its stored marker); subprocess-tree containment.
- Real Pi interactive TUI smoke test.

Review fixes: terminal bridge errors reject future requests; cancellation cleans pending state; Pi auth resolution requires the saved marker; ambiguous @ai-sdk/openai models are excluded. npm run typecheck checks the extension against installed Pi types without a provider-wide cast (skipLibCheck; bridge JS not strictly checked).

No upstream modifications, HTTP gateway, core fork or global configuration changes.

## 社区插件管理

已实现 Pi 1.6.0 原生菜单：直接输入 `/magpie-plugins`，用方向键选择、Enter 确认、Esc 退出。搜索输入关键词后选择包名、版本和描述，明确确认后按所选精确版本安装。也可查看已安装插件详情、卸载托管插件或直接输入包名。手动配置只读；取消不触发后续操作。无交互模式保留帮助和只读子命令，拒绝修改。菜单测试使用模拟 UI，未验证真实厂商服务或真实 Pi TUI。

保留原有子命令，空配置也可用：
- `/magpie-plugins help`
- `/magpie-plugins search cursor`
- `/magpie-plugins install cursor`（或完整包名及 @精确版本）
- `/magpie-plugins list`
- `/magpie-plugins remove workbuddy`

需要 npm。搜索仅查询 npm 元数据，限定社区 opencode-*-auth 包，不保证所有插件与当前 vendor host 兼容。cursor/workbuddy 是快捷别名。撤回的 antigravity-auth 不允许安装，agy-cli-auth 不受影响。

安装及移除必须 UI 明确确认，无交互模式拒绝修改。npm 使用 execFile、--ignore-scripts、--save-exact；禁用安装脚本不代表安全沙箱，运行插件仍拥有当前用户权限。下载使用独立 managed-plugins/pkg-* 目录，成功才原子替换配置并固定版本；失败保留原配置。跨进程锁拒绝并发修改，异常退出遗留 plugins.lock 时，确认没有操作运行后手动删除锁。

更新后必须重启 Pi，不尝试卸载运行中的代码。移除停用配置并将旧托管目录排队，下次启动、host 启动前安全清理；不删除凭据或手动插件。配置保留无关字段，新文件权限 0600。外部编辑器不遵守管理锁时仍应避免同时写配置。JSON 损坏需手动修复；插件加载失败时命令仍可用于移除。

确定性测试使用临时目录、模拟 registry 与 npm，不安装真实插件到用户状态。

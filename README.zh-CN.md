# magpie-pi

[English](README.md) | 简体中文

小型 Go stdio supervisor + 薄 Pi 扩展 + **原样抽取**的 magpie OpenCode Bun host。
没有 HTTP 监听、完整 gateway、Go→TS 翻译或 Pi core fork。插件负责账号、刷新和请求；Pi 原生 SDK 负责消息、工具和流式事件转换。

## 构建与安装

要求 Go 1.23+、Bun（本机测试 1.3.14）、Pi **1.6.0**、Node.js 和 npm（用于下载安装社区插件）。
从本目录执行：

```sh
node scripts/build.mjs
# 安装本地扩展（由用户主动执行，不会由构建脚本修改全局 Pi 配置）
pi install /absolute/path/magpie-pi
# 或仅本次加载
pi -e /absolute/path/magpie-pi/extension/index.ts
```

开发依赖使用 Pi 安装目录的 node_modules 或安装 package.json 中精确版本的 peerDependencies。本机 node_modules 是指向已有 Pi 安装的开发用链接，不属于发布内容。

本地路径安装直接引用项目目录，不会复制源码到 Pi 的插件目录。修改扩展后无需重新安装；修改 Go 代码后先重新执行 `node scripts/build.mjs`。涉及后台宿主或配置的更改请重启 Pi。

## 快速使用：菜单安装 → 登录 → 选择模型

完成上述构建后，可以持久安装并启动：

```sh
pi install ~/Code/agent-playground/magpie-pi
pi
```

如果项目放在其他位置，请替换路径。也可以不安装，仅使用前面的 `pi -e` 临时加载；此时每次重启仍需带上 `-e`。

1. 在 Pi 输入 `/magpie-plugins`，打开原生 TUI 菜单。用 **↑/↓** 选择、**Enter** 确认、**Esc** 退出；界面文字使用 English。
2. 选择 **Search and install**，输入 `cursor` 或 `workbuddy`，从搜索结果中选择包和版本。阅读权限提示并确认后，扩展会下载插件并自动保存配置，无需手动编辑 JSON。
3. 安装成功后退出并重新启动 Pi。若多个 Pi 实例共享状态目录，先全部退出再启动。
4. 输入 `/login`，选择对应服务并按照提示完成登录。扩展注册的 provider ID 带 `magpie-` 前缀，菜单中可能显示插件提供的服务名称。
5. 输入 `/model`，选择该服务提供的模型，然后正常聊天或使用工具。Pi 原有服务仍然可用。

其他菜单项：

| 菜单项 | 用途 |
| --- | --- |
| Installed plugins / details | 查看已配置插件和安装路径 |
| Uninstall | 选择托管插件并确认卸载；重启后清理旧文件，保留凭据 |
| Install by package name | 输入别名或完整包名，可附 `@精确版本` |
| Help | 查看文本子命令 |

也可以直接输入 `/magpie-plugins install cursor` 或 `/magpie-plugins install workbuddy`，仍需交互确认。再次安装同一托管插件可替换版本；不是后台自动更新。

**当前限制：**真实 Cursor/WorkBuddy 账号尚未验证，搜索或安装成功不代表模型调用兼容。若 `/login` 没有出现服务，先确认已重启并查看启动错误；若 `/model` 没有模型，该插件可能未提供当前支持的协议，见下方“支持范围”。本扩展尚未接入 magpie 的内置 Codex、Claude、Copilot、Gemini 账号实现。

## 配置与凭据（手动配置可选）

首次加载会自动创建独立状态目录 ~/.local/share/magpie-pi（0700）和空的 config.json（0600）。未配置插件时仅显示配置提示，不启动 Go/Bun，也不影响 Pi 原有服务。已有配置不会被覆盖；无效 JSON 会明确报错。

推荐使用菜单管理插件。只有需要使用自行安装的插件时，才手动编辑其中的 config.json，例如：

```json
{
  "plugins": [
    {
      "spec": "@magpie-community/opencode-cursor-auth",
      "target": "/absolute/plugin-install/node_modules/@magpie-community/opencode-cursor-auth"
    }
  ],
  "accounts": {},
  "opencode": {}
}
```

插件安装在用户选定的独立目录，用 npm install --save-exact 包名@明确版本，并保留 package-lock.json。target 必须指向已安装包或入口文件；本项目不会在启动时自动下载安装第三方代码；可手动配置或通过下方菜单明确确认安装。WorkBuddy 使用 @magpie-community/opencode-workbuddy-auth，同样不是旧 builtin。
不要为新用户安装已撤回的 Antigravity 插件。

MAGPIE_PI_STATE 可指定绝对状态目录，MAGPIE_PI_BUN 可指定 Bun 可执行文件。
在 Pi /login 选择扩展注册的服务（内部 ID 以 magpie- 开头）。支持 API key、OAuth 自动/粘贴代码登录，以及 host prompt/validate 条件表单；复杂厂商表单尚未实测。
真实 token 由原 host 写入独立 plugin-auth.json（0600），Pi 中仅保存 plugin-owned 标记。
多账号默认使用 host 的默认账号；config.accounts 可按插件 provider ID 固定账号 key。
Pi /logout 清除标记并停用此 provider，不删除插件凭据；再次使用需 /login。resolve 同时要求 Pi 保存的标记与 host 登录状态，不会绕过 Pi logout。尚无插件凭据删除命令。

## 支持范围

已测试完整 Go → Bun fixture 插件 → Pi 原生 OpenAI Chat SDK：登录、模型发现、文本、工具调用、取消及重启后的凭据持久化。
仅暴露 @ai-sdk/openai-compatible 的 Chat Completions 模型和 @ai-sdk/anthropic 的 Messages 模型。
Anthropic 路径使用 Pi 原生实现，但未进行真实服务/fixture 验证。Responses/Gemini 不支持；@ai-sdk/openai 无法可靠区分 Chat 与 Responses，全部隐藏，不会静默按 Chat 处理。
成本目前以 0 标记，表示未接入价格信息，不代表服务免费。
Cursor/WorkBuddy 真账号尚未验证，不宣称兼容全部社区插件。
没有提取 builtin Codex、Claude、Copilot、Gemini 账号逻辑，没有账号轮转、配额路由、gateway 转换、GUI、迁移工具或插件自动更新。普通 API 请直接用 Pi models.json。

插件是受信任的本地代码，具有当前用户权限，不是安全沙箱。Windows 文件权限取决于用户目录 ACL；跨平台编译不等于平台运行验证。仅 Linux 实测。

## 协议与生命周期

桥接协议 v1 使用固定 extraction.json 所锁定的 host JSON-lines 合约：
请求 {id,method,params}；响应 {id,result} / {id,error}。
fetch 先 head，再 base64 chunk，最后 result；credit 返回消费字节数加每帧 2048 的开销。
每请求初始窗口 65536，ReadableStream pull 才归还额度；abort 取消同一 id。
stdio 天然背压，Go 不缓冲完整响应。EOF 关闭 Bun stdin，2 秒后强制结束仍未退出的直接子进程。
插件自行派生的孙进程不提供进程树隔离。host 崩溃使 pending 请求失败，不自动重试生成。
没有本机监听端口。Go supervisor 只管理进程与状态权限，协议适配留在薄扩展中。

## 测试与更新

```sh
node scripts/extraction.mjs
node scripts/build.mjs
node --test tests/*.test.mjs
bun test tests/provider.test.ts
go vet ./...
go test -race ./...
node scripts/build.mjs --all
```

测试用临时状态目录和本地 fixture，不需要真实 token 或网络。
Go 当前没有单独单元测试；主要行为由实际编译二进制集成测试覆盖。
全平台产物在 bin/；部署时将对应产物命名为 magpie-pi（Windows 为 magpie-pi.exe），保留 vendor/ 和 extension/。

extraction.json 锁定来源 commit、每个文件 SHA-256、空补丁列表。vendor/LICENSE 为上游 MIT 许可证。
升级时先阅读上游设计，审查差异，然后显式执行：

```sh
node scripts/extraction.mjs extract /absolute/path/magpie
node scripts/extraction.mjs
# 重跑上述测试；检查新 extraction.json 后再发布
```

extract 从 git commit 读取字节，不复制工作区未提交修改；verify 检查本地 vendor 哈希。不修改 magpie 源码。

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

更新后必须重启 Pi，不尝试卸载运行中的代码。移除和替换版本将旧托管目录加入原子保存的删除队列，下次扩展启动、host 启动前删除。共享状态目录的 Pi 实例应全部退出再重启。凭据及手动插件永不删除。仅清理带本管理器所有权标记的 managed-plugins/pkg-* 目录；历史无标记目录或路径验证失败的目录保留，不能确认安全时需人工处理。配置保留无关字段，新文件权限 0600。外部编辑器不遵守管理锁时仍应避免同时写配置。JSON 损坏需手动修复；插件加载失败时命令仍可用于移除。

确定性测试使用临时目录、模拟 registry 与 npm，不安装真实插件到用户状态。

# magpie-pi

[English](README.md) | 简体中文

通过轻量 Pi 扩展和本地宿主，将 magpie 的社区插件集成带入 Pi。使用 stdio 对接 Pi 原生 SDK，无需 HTTP 网关或修改 Pi 核心。

本项目源自 [yetone/magpie](https://github.com/yetone/magpie)，原样抽取其 OpenCode 宿主。感谢原作者和维护者的付出。

## 安装

需要 **Pi 1.6.0**。

```sh
pi install npm:magpie-pi
pi
```

包内已包含预编译宿主程序。首次安装或启动插件时会自动下载 Bun（一次性下载约 25–40 MB），保存在状态目录的 `bun/` 下。

## 使用

1. 在 Pi 输入 `/magpie-plugins`。
2. 选择 **Search and install**，搜索 `cursor` 或 `workbuddy`，选择包和版本后确认安装。
3. 退出并重新启动 Pi。若多个实例共享状态目录，先全部退出再启动。
4. 输入 `/login`，选择对应服务并登录。
5. 输入 `/model`，选择模型后开始使用。

菜单用 ↑/↓ 选择、Enter 确认、Esc 取消，也支持查看已安装插件、按包名安装和卸载。Pi 原有服务不受影响。

第三方插件拥有当前用户权限，请仅安装可信插件。真实 Cursor/WorkBuddy 账号尚未验证。

## 配置与凭据

配置自动保存在 `~/.local/share/magpie-pi`，使用菜单管理插件无需手动编辑 JSON。

- `MAGPIE_PI_STATE`：指定其他状态目录，需使用绝对路径。
- `MAGPIE_PI_BUN`：指定 Bun 可执行文件，例如复用已安装的 Bun 而不再下载：`MAGPIE_PI_BUN=$(which bun)`（Bun 1.x，1.3.14 或更新）。
- `MAGPIE_PI_BUN_MIRROR`：Bun 下载源，可选 `github`（默认）、`npmmirror`、`npmmirror-cdn`，或提供 `bun-v<版本>/<文件名>.zip` 的 HTTPS 基础地址。所有来源都按内置的 SHA-256 校验。
- `/logout`：停用服务但不删除插件凭据；再次使用时执行 `/login`。

## 嵌入使用

通过 SDK 运行 Pi、并且多个会话共用一个模型运行时的宿主程序（例如 GUI 后端），不应在每个会话里加载扩展，而应使用嵌入 API：它只启动一次插件宿主，返回 Pi provider 定义，由宿主注册到自己的运行时中。

```js
import {prepareBun, startMagpie, PluginManager} from "magpie-pi/embed";

const magpie = await startMagpie(); // {providers, errors, close}
for (const provider of magpie.providers) modelRuntime.registerProvider(provider.id, provider);
// 用 PluginManager 安装或卸载插件后，close() 再重新启动即可生效。
await magpie.close();
```

启动宿主前可先准备 Bun，指定下载镜像并按字节显示进度。

```js
const bun = await prepareBun({mirror, onProgress});
const host = await startMagpie({bun, mirror});
```

配置和插件问题通过 `errors` 返回，不会抛出异常。`startMagpie()` 会设置 `MAGPIE_PI_EMBEDDED=1`，因此即使用户同时把它装成了 Pi 包，扩展在该进程里也不会生效。登录走 Pi 的 `AuthInteraction` 协议，因此由宿主自己的登录界面驱动插件登录。

## 许可证

项目自身暂标为 `UNLICENSED`。抽取的宿主保留 [vendor/LICENSE](vendor/LICENSE) 中的上游 MIT 许可证。

# magpie-pi

English | [简体中文](README.zh-CN.md)

Bring magpie's community plugin integrations to Pi through a lightweight extension and a local host. Uses Pi's native SDK over stdio, without an HTTP gateway or Pi core changes.

Derived from [yetone/magpie](https://github.com/yetone/magpie), with its OpenCode host extracted without modifications. Thanks to the original author and maintainers.

## Installation

Requires **Pi 1.6.0**, **Bun** to run community plugins, and **Node.js/npm** for plugin installation and management.

```sh
pi install npm:magpie-pi
pi
```

The npm package includes prebuilt supervisor binaries: **no Go installation or build command is needed**. Bun is required to run configured community plugins (tested with 1.3.14), not to load the extension or open its plugin manager.

## Usage

1. Enter `/magpie-plugins` in Pi.
2. Choose **Search and install**, search for `cursor` or `workbuddy`, select a package and version, then confirm.
3. Exit and restart Pi. If multiple instances share the state directory, exit all of them before restarting.
4. Enter `/login` and select the service.
5. Enter `/model` to select a model and start chatting.

Use ↑/↓ to navigate, Enter to confirm, and Esc to cancel. The menu also supports viewing installed plugins, installing by package name, and uninstalling. Pi's built-in providers remain available.

Third-party plugins run with your user privileges; install only plugins you trust. Real Cursor/WorkBuddy accounts remain unverified.

## State and credentials

Configuration is created automatically in `~/.local/share/magpie-pi`; manual JSON editing is not needed for menu-managed plugins.

- `MAGPIE_PI_STATE`: override the state directory with an absolute path.
- `MAGPIE_PI_BUN`: override the Bun executable.
- `/logout`: disables the provider without deleting plugin credentials; use `/login` to enable it again.

## Embedding

Hosts that run Pi through its SDK with one shared model runtime for many sessions (for example a GUI backend) should not load the extension per session. Use the embedding API instead: it starts the plugin host once and returns Pi provider definitions to register in the host's own runtime.

```js
import {startMagpie, PluginManager} from "magpie-pi/embed";

const magpie = await startMagpie(); // {providers, errors, close}
for (const provider of magpie.providers) modelRuntime.registerProvider(provider.id, provider);
// After installing or removing plugins with PluginManager, close() and start again to apply them.
await magpie.close();
```

Configuration and plugin problems are returned in `errors` instead of being thrown. `startMagpie()` sets `MAGPIE_PI_EMBEDDED=1`, so the Pi extension stays inactive in that process even if a user also installed it as a Pi package. Login uses Pi's `AuthInteraction` protocol, so the host's own login UI drives plugin sign-in.

## License

The project's own license is currently `UNLICENSED`. The extracted host retains its upstream MIT license in [vendor/LICENSE](vendor/LICENSE).

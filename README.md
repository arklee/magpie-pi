# magpie-pi

English | [简体中文](README.zh-CN.md)

Bring magpie's community plugin integrations to Pi through a lightweight extension and a local Go/Bun host.

Derived from [yetone/magpie](https://github.com/yetone/magpie), with its OpenCode host extracted without modifications. Thanks to the original author and maintainers for their work and continued dedication.

Uses Pi's native SDK over stdio—no HTTP gateway or Pi core fork.

## Installation

Requires Pi **1.6.0**, Bun (locally tested with 1.3.14), Node.js, and npm for community plugin management.

The npm package has not been published yet. For now, use a local checkout and complete [Build from source](#build-from-source) below, then install and start Pi:

```sh
pi install /absolute/path/magpie-pi
pi
```

Replace the path with your checkout. To load the extension for one session without installing:

```sh
pi -e /absolute/path/magpie-pi/extension/index.ts
```

With temporary loading, include `-e` again after each restart.

## Usage: install a plugin → log in → select a model

1. Enter `/magpie-plugins` in Pi to open the native TUI menu. Use **↑/↓** to select, **Enter** to confirm, and **Esc** to exit. UI text is in English.
2. Choose **Search and install**, enter `cursor` or `workbuddy`, then select a package and version. After you read the permissions notice and confirm, the extension downloads the plugin and saves its configuration automatically—no manual JSON editing needed.
3. Exit and restart Pi after installation. If multiple Pi instances share the state directory, exit all of them before restarting.
4. Enter `/login`, select the service, and follow the login prompts. Registered provider IDs have a `magpie-` prefix; menus may display the service name supplied by the plugin.
5. Enter `/model`, select a model from that service, and chat or use tools normally. Pi's built-in services remain available.

Other menu entries:

| Menu entry | Purpose |
| --- | --- |
| Installed plugins / details | View configured plugins and installation paths |
| Uninstall | Select and confirm removal of a managed plugin; old files are cleaned up after restart, preserving credentials |
| Install by package name | Enter an alias or full package name, optionally with `@exact-version` |
| Help | View text subcommands |

You can also enter `/magpie-plugins install cursor` or `/magpie-plugins install workbuddy`; interactive confirmation is still required. Reinstalling a managed plugin can replace its version; this is not an automatic background update.

**Current limitations:** Real Cursor/WorkBuddy accounts have not been verified. Successful search or installation does not establish model-call compatibility. If a service is missing from `/login`, confirm you restarted and check startup errors. If `/model` lists no models, the plugin may not expose a supported protocol; see “Supported scope” below. This extension does not yet integrate magpie's built-in Codex, Claude, Copilot, or Gemini account implementations.

## Configuration and credentials (manual configuration is optional)

On first load, the extension creates a separate state directory, `~/.local/share/magpie-pi` (0700), and an empty `config.json` (0600). With no plugins configured, it only displays a configuration hint: Go/Bun are not started, and Pi's existing services are unaffected. Existing configuration is not overwritten; invalid JSON produces an explicit error.

Use the menu to manage plugins. Manual editing of `config.json` is only needed for plugins you install yourself, for example:

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

For manual installation, use a separate directory of your choice, run `npm install --save-exact package-name@exact-version`, and retain `package-lock.json`. `target` must point to an installed package or entry file. This project does not automatically download third-party code at startup; configure it manually or explicitly confirm installation through the menu. WorkBuddy uses `@magpie-community/opencode-workbuddy-auth`, not the old built-in implementation.
Do not install the withdrawn Antigravity plugin for new users.

`MAGPIE_PI_STATE` selects an absolute state directory; `MAGPIE_PI_BUN` selects the Bun executable.
Use Pi's `/login` to select an extension-registered service (internal IDs start with `magpie-`). API keys, automatic/code-paste OAuth, and conditional host prompt/validate forms are supported; complex vendor forms have not been tested live.
The original host stores real tokens in a separate `plugin-auth.json` (0600); Pi stores only a `plugin-owned` marker.
For multiple accounts, the host's default account is used unless `config.accounts` pins an account key by plugin provider ID.
Pi's `/logout` clears the marker and disables the provider without deleting plugin credentials; use `/login` to enable it again. Resolution requires both Pi's saved marker and the host's login state, so cached credentials cannot bypass Pi logout. There is no plugin-credential deletion command yet.

## Supported scope

The full Go → Bun fixture plugin → Pi native OpenAI Chat SDK path has been tested for login, model discovery, text, tool calls, cancellation, and credential persistence across restarts.
Only Chat Completions models from `@ai-sdk/openai-compatible` and Messages models from `@ai-sdk/anthropic` are exposed.
The Anthropic path uses Pi's native implementation but has not had real-service or fixture verification. Responses/Gemini are unsupported. Because `@ai-sdk/openai` does not reliably distinguish Chat from Responses, all its models are hidden rather than silently treated as Chat.
Costs are currently marked as 0 to indicate missing pricing information, not free service.
Real Cursor/WorkBuddy accounts remain unverified; compatibility with all community plugins is not claimed.
Built-in Codex, Claude, Copilot, and Gemini account logic has not been extracted. There is no account rotation, quota routing, gateway conversion, GUI, migration tooling, or automatic plugin updating. For ordinary APIs, use Pi's `models.json` directly.

Plugins are trusted local code running with the current user's privileges, not a security sandbox. Windows file permissions depend on the user directory's ACL. Cross-platform compilation does not establish runtime support; only Linux has been tested at runtime.

## Protocol and lifecycle

Bridge protocol v1 uses the host JSON-lines contract pinned by `extraction.json`:
requests `{id,method,params}`; responses `{id,result}` / `{id,error}`.
Fetch sends a head, then base64 chunks, then a result. Credit returns the consumed byte count plus 2048 bytes of overhead per frame.
Each request starts with a 65536-byte window; credit is returned only on `ReadableStream` pull. Abort cancels the same ID.
Stdio provides backpressure; Go does not buffer complete responses. EOF closes Bun's stdin; direct children still running after two seconds are forcibly terminated.
Plugin-spawned grandchildren are not contained as a process tree. A host crash fails pending requests; generation is not retried automatically.
There is no local listening port. The Go supervisor manages only processes and state permissions; protocol adaptation stays in the thin extension.

## Build from source

Requires Go 1.23+ in addition to the runtime dependencies above. From the project directory:

```sh
node scripts/build.mjs
```

The build does not change global Pi settings. For development dependencies, use the Pi installation's node_modules or install the exact peerDependencies versions in package.json. The local node_modules is a development symlink, not part of the release.

Local-path installation references the checkout directly. Extension edits do not require reinstallation; after Go changes, rerun the build. Restart Pi after host or configuration changes.

## Testing and updates

```sh
node scripts/extraction.mjs
node scripts/build.mjs
node --test tests/*.test.mjs
bun test tests/provider.test.ts
go vet ./...
go test -race ./...
node scripts/build.mjs --all
```

Tests use temporary state directories and local fixtures, requiring neither real tokens nor network access.
Go currently has no standalone unit tests; its main behavior is covered by integration tests using the compiled binary.
Cross-platform artifacts are in `bin/`. Keep their platform-specific names, such as `magpie-pi-linux-amd64` and `magpie-pi-windows-arm64.exe`; the extension selects the matching binary automatically. Retain `vendor/` and `extension/`. A local build also creates the legacy `magpie-pi` / `magpie-pi.exe` alias for integration tests.

### npm packaging preparation

The package whitelist includes `extension/`, `vendor/`, `bin/`, the extraction manifest, and both READMEs. Run `node scripts/build.mjs --all` before packaging to include all six platform binaries. Package users need Bun and compatible Pi, but not Go. Only Linux runtime behavior has been verified. These packaging changes do not mean the package has been published.

The project's own license is currently `UNLICENSED`; choose an explicit distribution license before public release. The extracted host retains its upstream MIT license in `vendor/LICENSE`.

`extraction.json` pins the source commit, per-file SHA-256 hashes, and an empty patch list. `vendor/LICENSE` contains the upstream MIT license.
Before updating, read the upstream design and review changes, then explicitly run:

```sh
node scripts/extraction.mjs extract /absolute/path/magpie
node scripts/extraction.mjs
# Rerun the tests above and review the new extraction.json before publishing.
```

Extraction reads bytes from the git commit, not uncommitted working-tree changes. Verification checks local vendor hashes. Neither modifies magpie's source.

## Community plugin management

Native Pi 1.6.0 menus are implemented: enter `/magpie-plugins`, use arrow keys to select, Enter to confirm, and Esc to exit. Search by keyword, select a package, version, and description, then explicitly confirm installation of the exact selected version. You can also view installed-plugin details, uninstall managed plugins, or enter a package name directly. Manually configured plugins are read-only; cancellation triggers no subsequent actions. Noninteractive mode retains help and read-only subcommands but rejects mutations. Menu tests use mocked UI; neither real vendor services nor the live Pi TUI have been verified.

Text subcommands remain available, even with empty configuration:
- `/magpie-plugins help`
- `/magpie-plugins search cursor`
- `/magpie-plugins install cursor` (or a full package name with `@exact-version`)
- `/magpie-plugins list`
- `/magpie-plugins remove workbuddy`

Requires npm. Search queries npm metadata only and is restricted to community `opencode-*-auth` packages; compatibility with the current vendor host is not guaranteed. `cursor` and `workbuddy` are aliases. The withdrawn `antigravity-auth` cannot be installed; `agy-cli-auth` is unaffected.

Installation and removal require explicit UI confirmation; noninteractive mutations are rejected. npm runs through `execFile` with `--ignore-scripts` and `--save-exact`. Disabling install scripts is not a security sandbox: runtime plugins still have the current user's privileges. Downloads use separate `managed-plugins/pkg-*` directories; configuration is atomically replaced and the version pinned only on success. Failures preserve the original configuration. A cross-process lock rejects concurrent mutations. If a crash leaves `plugins.lock`, confirm no operation is running before manually deleting the lock.

Restart Pi after changes; running code is not unloaded. Removal and version replacement add old managed directories to an atomically saved deletion queue, processed at the next extension startup before the host starts. Exit all Pi instances sharing the state directory before restarting. Credentials and manually configured plugins are never deleted. Cleanup only removes `managed-plugins/pkg-*` directories with this manager's ownership marker. Legacy unmarked directories and directories that fail path validation are retained; cases whose safety cannot be established require manual handling. Unrelated configuration fields are preserved, and new files use mode 0600. Avoid simultaneous configuration writes from external editors that do not honor the management lock. Corrupt JSON requires manual repair; commands remain available for removal when a plugin fails to load.

Deterministic tests use temporary directories and mocked registry/npm operations, never installing real plugins into user state.

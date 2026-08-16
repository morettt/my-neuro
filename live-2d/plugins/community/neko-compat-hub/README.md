# N.E.K.O Compatibility Hub

`neko-compat-hub` is a my-neuro community plugin that uses N.E.K.O as an
optional local background capability container. my-neuro remains responsible
for the visible character, main conversation, and TTS.

The Hub does not bundle N.E.K.O, its dependencies, Steam content, or any
third-party N.E.K.O plugins. You prepare a compatible local N.E.K.O source
checkout or Steam installation yourself, then opt in to the capabilities you
want to expose.

## Security model

The Hub is disabled by default. Until both `enabled` is turned on and
`runtime_checkout_path` is configured, it does not start a process or register
any `neko__*` tools.

When enabled, the N.E.K.O user-plugin service listens on `127.0.0.1` without
its own authentication. Only enable the Hub on a trusted local machine and
stop it when it is not needed. The Hub's deny-by-default authorization protects
which N.E.K.O tools my-neuro exposes to an LLM; it does not prevent other local
processes from connecting directly to that loopback service.

The Hub never imports N.E.K.O account settings, cookies, room IDs, API keys,
or login state. Those remain in the user's N.E.K.O environment.

## Configuration

Open the plugin's configuration page after installing it in
`plugins/community/neko-compat-hub/`.

| Setting | Purpose |
| --- | --- |
| `enabled` | Main switch. `false` keeps the Hub inert. |
| `runtime_checkout_path` | Local N.E.K.O source checkout or Steam installation directory. Leave empty to keep the Hub inert. |
| `runtime_python_path` | Optional Python 3.11 path for a source checkout. A Steam installation uses its bundled runtime. |
| `runtime_port` | Preferred loopback port. The Hub chooses an available local port if needed. |
| `pack_*` | Explicit allow switches for official Steam plugin packs. Every pack defaults to `false`. |
| `approved_entries` | Advanced allow list. Use one `plugin_id:entry_id` or `plugin_id:*` entry per line. |
| `force_allow_entries` | Exact override for a B0 false positive. It never accepts wildcards. |
| `expose_fixture_tools` | Compatibility switch for fixture-only tools. It defaults to `false`. |

Changing configuration in the WebUI writes `plugin_config.json`, but the
upstream host does not guarantee a configuration-change callback. Restart
my-neuro or reload this plugin after saving configuration before relying on
the new settings.

`approved_entries` and enabled `pack_*` values are merged. A wildcard pack
approval exposes only entries already classified as C2. It does not expose
C0, C3, C4, C5, or B0 entries. `mcp_adapter` remains blocked even if its
checkbox is selected.

## Runtime prerequisites

The source-checkout route is locked by `runtime-lock.json` and requires Python
3.11. The Steam route uses a compatible installed N.E.K.O directory and does
not make the Hub download or install anything.

Example placeholder paths are intentionally generic:

```text
C:\path\to\N.E.K.O
C:\path\to\python311.exe
```

Do not add those paths, credentials, or generated reports to source control.

## Privacy and generated files

Runtime state, logs, and compatibility reports are written below:

```text
.runtime/
```

That directory is ignored by this plugin's `.gitignore`. It can contain local
paths, process state, and diagnostic information, so it must not be committed
or shared as part of a normal source contribution.

The tracked `plugin_config.json` contains only safe public defaults. A deployed
copy may be changed by the WebUI on the user's machine; treat that deployment
copy as local configuration, not as a file to contribute upstream.

## Tests

From this plugin directory:

```powershell
node --test tests/*.test.js
```

The real Runtime smoke test is opt-in and is skipped unless
`NEKO_HUB_SMOKE=1` is explicitly set with a user-provided local Runtime path.
It is not required for normal source checks and should only be run in a
controlled local environment.

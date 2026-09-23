# opencode-model-hide

OpenCode plugin that lets you hide models from the model picker — managed entirely
from the terminal UI with a picker-style selection dialog, no config editing required.

- `/model-hide` (or `Ctrl+Shift+h`): open the model list, arrow-key through it, and
  press Enter to toggle the highlighted model between hidden and visible.
- Server side, hidden models are removed from the active model catalog, so they
  disappear from `opencode models`, `/models`, and every OpenCode instance for the
  user account — across restarts and catalog refreshes.
- Everything else (other providers, other models) is left untouched.

## Install

```bash
npm install @franiboy/opencode-model-hide
```

Then reference it like any OpenCode plugin:

```jsonc title="opencode.jsonc"
{
  "plugins": ["@franiboy/opencode-model-hide"]
}
```

For the TUI part (the in-terminal selector), also configure the terminal client:

```jsonc title="~/.config/opencode/cli.json"
{
  "plugins": ["@franiboy/opencode-model-hide"]
}
```

## Bridge file

Hidden models are stored in `~/.config/opencode/model-hide.json`:

```json
{
  "hidden": ["opencode-go/kimi-k2.6", "opencode-go/grok-4.6"]
}
```

- Changes are picked up automatically (1.5s watch, `ctx.model.reload()`).
- `MODEL_HIDE_BRIDGE_FILE` can move the file location.

## Standalone, without the plugin packages

The server-side filter ships as a single self-contained file suitable for the
`.opencode/plugins/` approach (symlinks do not load; use a real copy):

- https://github.com/Franiboy/opencode-model-hide/blob/main/model-hide.ts

## License

MIT

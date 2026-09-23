# opencode-model-hide

OpenCode plugin that lets you hide models from the model picker — managed entirely
from the terminal UI with a picker-style selection dialog, no config editing required.

- `/model-hide` (or `Ctrl+Shift+h`): open the stylesheet-free model list, arrow-key
  through it, and press Enter to toggle the highlighted model between hidden and visible.
- Server side, hidden models are removed from the active model catalog, so they
  disappear from `opencode models`, `/models`, and every OpenCode instance for the
  user account — across restarts and catalog refreshes.
- Everything else (other providers, other models) is left untouched.

## How it works

- The TUI part (`./tui`) renders the selector and persists toggles to
  `~/.config/opencode/model-hide.json` (a `{"hidden": ["provider/model", ...]}` file).
- The server part (`.`) watches that file and applies a `ctx.model.transform` that
  removes hidden models from the active catalog.

## Install

```bash
# project-local
npm install opencode-model-hide
# or for your user, via ~/.config/opencode/opencode.jsonc:
# { "plugins": ["opencode-model-hide"] }
```

## License

MIT

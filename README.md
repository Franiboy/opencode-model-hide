# opencode-model-hide

OpenCode plugin (single file, server-side): hides models from the model picker.

## Installation

## Installation

No npm install of plugin packages is needed — it ships as one TypeScript file.

```bash
# project-local (the "directly in the project" approach):
mkdir -p .opencode/plugins
curl -L -o .opencode/plugins/model-hide.ts \
  https://github.com/Franiboy/opencode-model-hide/raw/main/model-hide.ts
```

Optionally ignore it in the project's `.gitignore`:

```
.opencode/plugins/model-hide.ts
```

The user-directory variant also works (verified):

```bash
curl -L -o ~/.config/opencode/plugins/model-hide.ts \
  https://github.com/Franiboy/opencode-model-hide/raw/main/model-hide.ts
```

> **Symlinks are not reliable here.** OpenCode 2.0.15 fails to resolve a symlinked
> plugin file (`Cannot find module ... from ''`) and silently skips it. Use a real
> copy or a copy step in your dotfiles workflow instead.

Keep the source in the git-working copy (`~/git/opencode-model-hide`) and link it —
same setup as this repository.

## What it does

- The model selection filter is persisted to `~/.config/opencode/model-hide.json`.
- Every hidden entry removes the matching OpenCode model from the picker.
- List entries look like `provider/model-id`; filtering is a plain string match.

The plan is: JSON `{"hidden": ["provider/model", ...]}`, nothing else.

- The plugin watches that bridge file (1.5 s poll) and requests `ctx.model.reload()`
  automatically, so changes apply without a server restart.
- `MODEL_HIDE_BRIDGE_FILE` environment variable can move the bridge location.

## Usage

Edit `~/.config/opencode/model-hide.json` (locally also relocated via environment
variable):

```json
{
  "hidden": ["opencode-go/kimi-k2.6", "opencode-go/grok-4.6"]
}
```

Changes are picked up automatically and OpenCode's model picker updates — you'll see
them disappear from `/models` and `opencode models` while everything else stays.

## License

MIT

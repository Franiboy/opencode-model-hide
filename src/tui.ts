import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";

const DEFAULT_BRIDGE = path.join(os.homedir(), ".config", "opencode", "model-hide.json");

function bridgePath() {
  return process.env.MODEL_HIDE_BRIDGE_FILE ?? DEFAULT_BRIDGE;
}

function readHidden(): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(), "utf8")) as { hidden?: unknown };
    if (Array.isArray(parsed.hidden)) return new Set(parsed.hidden.map(String));
  } catch {
    // Missing or malformed file: treat as "nothing hidden".
  }
  return new Set();
}

function writeHidden(hidden: Set<string>): void {
  fs.mkdirSync(path.dirname(bridgePath()), { recursive: true });
  fs.writeFileSync(bridgePath(), JSON.stringify({ hidden: [...hidden].sort() }, null, 2) + "\n");
}

// Temporary debug helper: capture the real CLI context shape so the plugin can
// adapt to the API of the installed OpenCode version. Remove once the selector
// is verified end-to-end.
function dumpShape(context: unknown): void {
  try {
    const ctx = context as Record<string, unknown>;
    const shape: Record<string, string> = {};
    for (const [key, value] of Object.entries(ctx)) {
      shape[key] =
        typeof value === "object" && value !== null
          ? Object.keys(value).join(",")
          : String(typeof value);
    }
    fs.mkdirSync("/tmp/opencode", { recursive: true });
    fs.writeFileSync("/tmp/opencode/cli-context-shape.json", JSON.stringify(shape, null, 2));
  } catch {
    // Diagnostics must not break the plugin.
  }
}

export default Plugin.define({
  id: "model-hide.tui",
  setup(context) {
    dumpShape(context);
    const ctx = context as {
      ui?: unknown;
      keymap?: { layer: (fn: () => unknown) => unknown };
    };

    if (!ctx.keymap || typeof ctx.keymap.layer !== "function") {
      return;
    }

    ctx.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "model-hide.manage",
          title: "Manage hidden models",
          group: "Model hide",
          bind: "ctrl+shift+h",
          palette: true,
          slash: { name: "model-hide", arguments: false },
          enabled: () => true,
          run: async () => {
            const location = context.location ?? context.data.location.default();
            await context.data.location.model.sync(location);
            const models = (context.data.location.model.list(location) ?? [])
              .map((model: { providerID?: string; modelID?: string; id?: string }) =>
                model?.providerID && (model.modelID ?? model.id)
                  ? `${model.providerID}/${model.modelID ?? model.id}`
                  : null,
              )
              .filter((value: string | null): value is string => Boolean(value))
              .sort();

            if (models.length === 0) {
              context.ui.toast.show({ message: "No models available yet", variant: "warning" });
              return;
            }

            for (;;) {
              const hidden = readHidden();
              const options = models.map((ref: string) => ({
                title: hidden.has(ref) ? `${ref}  (hidden)` : ref,
                description: hidden.has(ref) ? "Hidden from the picker" : "",
                value: ref,
              }));
              const picked = await context.ui.dialog.select({
                title: "Model hide — select a model to toggle",
                options,
              });
              if (!picked) return;
              if (hidden.has(picked)) hidden.delete(picked);
              else hidden.add(picked);
              writeHidden(hidden);
              context.ui.toast.show({
                message: hidden.has(picked) ? `Hidden: ${picked}` : `Visible again: ${picked}`,
                variant: "success",
              });
            }
          },
        },
      ],
      bindings: ["model-hide.manage"],
    }));
  },
});

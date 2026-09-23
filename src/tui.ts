import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin/tui";

const BRIDGE_FILE = path.join(os.homedir(), ".config", "opencode", "model-hide.json");

function readHidden(): Set<string> {
  try {
    const raw = fs.readFileSync(BRIDGE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { hidden?: unknown };
    if (Array.isArray(parsed.hidden)) return new Set(parsed.hidden.map(String));
  } catch {
    // Missing or malformed file: start from an empty list.
  }
  return new Set();
}

function writeHidden(hidden: Set<string>): void {
  fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true });
  const payload = { hidden: [...hidden].sort() };
  fs.writeFileSync(BRIDGE_FILE, JSON.stringify(payload, null, 2) + "\n");
}

export default Plugin.define({
  id: "model-hide.tui",
  setup(context) {
    context.keymap.layer(() => ({
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

            for (;;) {
              const hidden = readHidden();
              const options = models.map((ref: string) => ({
                title: hidden.has(ref) ? `${ref}  (hidden)` : ref,
                description: hidden.has(ref) ? "Hidden from the picker" : "",
                value: ref,
              }));
              if (models.length === 0) {
                context.ui.toast.show({ message: "No models available yet", variant: "warning" });
                return;
              }
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

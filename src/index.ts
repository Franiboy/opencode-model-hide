import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin";

const BRIDGE_FILE = path.join(os.homedir(), ".config", "opencode", "model-hide.json");

function readHidden() {
  try {
    const raw = fs.readFileSync(BRIDGE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.hidden)) return parsed.hidden.map((e) => String(e));
  } catch {
    // Missing or malformed file: treat as "nothing hidden".
  }
  return [];
}

export default Plugin.define({
  id: "model-hide",
  async setup(ctx) {
    let hidden = new Set(readHidden());

    const apply = async (next) => {
      hidden = next;
      await ctx.model.reload();
    };

    await ctx.model.transform((editor) => {
      for (const model of editor.list()) {
        if (hidden.has(`${model.providerID}/${model.id}`)) {
          editor.remove(model.providerID, model.id);
        }
      }
    });

    // The TUI side and other tooling update the bridge file; pick up
    // changes via a watched-read loop and replay the model transforms.
    let lastBox = "";
    fs.watchFile(BRIDGE_FILE, { interval: 1500 }, () => {
      try {
        const next = new Set(readHidden());
        if (next.size === hidden.size && [...next].every((m) => hidden.has(m))) return;
        void apply(next);
      } catch {
        // Keep the last known list on transient read errors.
      }
    });

    return () => fs.unwatchFile(BRIDGE_FILE);
  },
});

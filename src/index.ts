import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin } from "@opencode/plugin";

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

export default Plugin.define({
  id: "model-hide",
  async setup(ctx) {
    let hidden = readHidden();

    await ctx.model.transform((editor) => {
      for (const model of editor.list()) {
        if (hidden.has(`${model.providerID}/${model.id}`)) {
          editor.remove(model.providerID, model.id);
        }
      }
    });

    let lastSig = "";
    const sig = () => {
      try {
        const s = fs.statSync(bridgePath());
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return "";
      }
    };
    lastSig = sig();

    fs.watchFile(BRIDGE_FILE, { interval: 1500 }, () => {
      const next = sig();
      if (next === lastSig) return;
      lastSig = next;
      try {
        hidden = readHidden();
        void ctx.model.reload();
      } catch {
        // Keep the last known list on transient read errors.
      }
    });

    return () => fs.unwatchFile(BRIDGE_FILE);
  },
});

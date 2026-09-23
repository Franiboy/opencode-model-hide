import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Bridge file shared with the model selection tooling.
const BRIDGE_FILE = path.join(os.homedir(), ".config", "opencode", "model-hide.json");

function bridgePath() {
  // Allow overriding the session storage location through env (will be read lazily).
  return process.env.MODEL_HIDE_BRIDGE_FILE ?? BRIDGE_FILE;
}

function readHidden() {
  try {
    const parsed = JSON.parse(fs.readFileSync(bridgePath(), "utf8"));
    if (Array.isArray(parsed?.hidden)) return new Set(parsed.hidden.map(String));
  } catch {
    // Missing or malformed file: treat as nothing hidden.
  }
  return new Set();
}

export default {
  id: "model-hide",
  async setup(ctx) {
    let hidden = readHidden();

    await ctx.model.transform((editor) => {
      for (const model of editor.list()) {
        if (hidden.has(`${model.providerID}/${model.id}`)) editor.remove(model.providerID, model.id);
      }
    });

    let lastSig = "";
    let timer = null;
    const sig = () => {
      try {
        const s = fs.statSync(bridgePath());
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return "";
      }
    };
    lastSig = sig();

    timer = setInterval(() => {
      const next = sig();
      if (next === lastSig) return;
      lastSig = next;
      try {
        hidden = readHidden();
        void ctx.model.reload();
      } catch {
        // Ignore transient read errors, keep the last known list.
      }
    }, 1500);

    return () => clearInterval(timer);
  },
};

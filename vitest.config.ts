import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Some tests exercise the real bridge-file watcher, which is timer based:
    // fs.watchFile polls every 500ms and the reload is debounced by 250ms. The
    // 5s vitest default is not enough on a loaded CI runner, and the failure
    // mode is a timeout rather than a wrong assertion, so the whole file gets
    // a budget here.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});

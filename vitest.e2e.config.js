import { defineConfig } from "vitest/config";

// The Reign of Swords map runner (tools/ros/e2e-maps.mjs) — whole battles played by the Autopilot, far too slow for
// the unit suite, so they live apart: `npm run e2e:maps`. Same jsdom environment and setup as vitest.config.js.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/reign-of-swords/e2e/**/*.e2e.js"],
    setupFiles: ["src/reign-of-swords/__tests__/setup.js"],
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 120000,
  },
});

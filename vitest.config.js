import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit tests for the Reign of Swords game (src/reign-of-swords/__tests__). Separate from vite.config.js so the site
// build's plugins stay out of the test run. jsdom gives the engine and the React screens a window / document /
// localStorage. Coverage: `npm run coverage`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx}"],
    setupFiles: ["src/reign-of-swords/__tests__/setup.js"],
    testTimeout: 120000,
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      include: ["src/reign-of-swords/**/*.{js,jsx}"],
      exclude: ["src/reign-of-swords/__tests__/**"],
      reporter: ["text", "json-summary"],
    },
  },
});

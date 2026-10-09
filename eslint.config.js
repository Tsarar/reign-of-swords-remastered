// ESLint for the Reign of Swords re-creation (src/reign-of-swords). `npm run lint`.
// The rules that matter most here are the correctness ones: an undefined name (a missing import) or a hook used
// wrongly only fails when that screen renders, so the linter catches it before a player does.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  {
    files: ["src/reign-of-swords/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "detect" } },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/jsx-no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/reign-of-swords/__tests__/**", "src/reign-of-swords/e2e/**"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];

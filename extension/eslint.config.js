import js from "@eslint/js";
import solid from "eslint-plugin-solid/configs/recommended";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";

// Flat config (ESLint 9+). Lints every source file (entrypoints/, lib/,
// scripts/). node_modules is ignored by default, but wxt's generated
// output dirs are not, so they're ignored explicitly here.
export default [
  { ignores: ["dist/**", ".output/**", ".wxt/**"] },
  js.configs.recommended,
  solid,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
];

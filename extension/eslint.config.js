import js from "@eslint/js";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid/configs/recommended";
import globals from "globals";

// Flat config (ESLint 9+). Lints every JS/TS/JSX/TSX source file in the
// extension (entrypoints/, lib/, scripts/); build output and
// node_modules are excluded by default (no need to list them here).
export default tseslint.config(
  // Generated/build output: wxt writes type declarations and re-exports
  // under .wxt/, and build artifacts land in .output/ and dist/. None
  // of this is source we maintain, so it must never be linted.
  { ignores: [".wxt/**", ".output/**", "dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  solid,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        // WXT auto-imports these (see wxt.config.ts / entrypoints/*.ts);
        // they're never explicitly imported, so ESLint needs to be told
        // about them by hand.
        browser: "readonly",
        defineBackground: "readonly",
        defineContentScript: "readonly",
        createIframeUi: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // @typescript-eslint/no-unused-vars (from tseslint.configs.recommended
      // above) replaces the base rule: the base rule doesn't understand
      // TS-only constructs like function-type parameter names in
      // interfaces, and flags them as unused even though they're just
      // documentation for the type, not real bindings.
      "no-unused-vars": "off",
    },
  },
);

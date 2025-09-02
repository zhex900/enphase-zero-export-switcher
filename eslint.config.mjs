import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "a.js",
      "a.sh",
      "dist/**",
      "infra/dist/**",
      "node_modules/**",
      "infra/node_modules/**",
      "src/functions/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.cjs", "**/*.mjs"],
    settings: {
      "import/resolver": {
        typescript: {
          project: ["./tsconfig.json", "./infra/tsconfig.json"],
        },
      },
    },
    plugins: { import: importPlugin },
    rules: {
      "import/order": [
        "warn",
        {
          "newlines-between": "always",
          groups: [
            ["builtin", "external"],
            ["internal", "parent", "sibling", "index"],
            ["object", "type"],
          ],
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
    },
  },
  prettierConfig,
];

import js from "@eslint/js";
import solid from "eslint-plugin-solid";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        tsconfigRootDir: process.cwd(),
        project: false,
      },
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      solid.configs["flat/recommended"],
      prettier,
    ],
    rules: {
      "@typescript-eslint/consistent-type-imports": "warn",
      "solid/jsx-no-undef": "error",
      "solid/no-react-specific-props": "warn",
    },
  },
);

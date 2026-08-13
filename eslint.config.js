import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "data/**",
      "release/**",
      "coverage/**",
      "scripts/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: "off" },
    files: ["backend/src/**/*.ts", "frontend/src/**/*.{ts,tsx}", "shared/src/**/*.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
    },
  },
);

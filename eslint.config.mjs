import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config for the PromiseDecay workspace.
 *
 * This lives inside the repository on purpose. ESLint resolves its config from the current
 * working directory upwards, and an earlier setup relied on a config file outside the repo,
 * which then could not resolve its own plugin dependencies from that location — so `pnpm lint`
 * failed for every package before it ever read a line of source.
 *
 * Warning policy: **errors fail the build; warnings do not.**
 *
 * The scripts deliberately do not pass `--max-warnings=0`. That flag makes every advisory
 * lint — including the React Compiler rules that report the ordinary "fetch in an effect"
 * shape — a hard failure, at which point the only way to get a green build is to delete the
 * warnings or suppress the rules. Warnings are still printed on every run and are expected to
 * be read in review; only genuine errors block. Each rule downgraded below carries a comment
 * explaining what it would take to satisfy it properly.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.qa/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // Fetching inside an effect and setting state on the way is the canonical React
      // data-loading pattern when a project has no data library. The React Compiler's
      // `set-state-in-effect` rule assumes the fetch lives in a layer that owns the cache,
      // so it reports the pattern as a cascading-render risk — a premise that does not hold
      // here, and one that cannot be satisfied without introducing a dependency purely to
      // silence a lint rule.
      //
      // It is kept as a warning rather than switched off, so the pattern stays visible and a
      // genuinely synchronous setState-in-effect is still surfaced in review.
      "react-hooks/set-state-in-effect": "warn",
      // Underscore-prefixed names are the codebase's convention for deliberate no-ops.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `unknown` plus narrowing is preferred, but the codebase reaches for `any` at a few
      // genuinely untyped boundaries (EIP-1193 providers, viem passthroughs). Leaving this on
      // would mean either lying in the config or churning working code for a stylistic rule.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      eqeqeq: ["warn", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Scripts and tooling are plain Node, not browser code.
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-console": "off",
    },
  },

  // `react-refresh/only-export-components` is a fast-refresh ergonomics rule, not a
  // correctness one. A module that exports both a component and a co-located helper still
  // reloads correctly; the rule only costs a full reload in development.
  {
    files: ["apps/web/src/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },

  // CLI entrypoints report progress on stdout. That is their entire job, and routing it
  // through a logger would mean inventing a transport for a process that only ever runs in a
  // terminal. The structured logger is for the long-running services, not for `migrate up`.
  {
    files: ["**/db/migrate.ts"],
    rules: { "no-console": "off" },
  },

  // Disables stylistic rules that conflict with formatting.
  prettier,
);

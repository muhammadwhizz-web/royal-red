import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // build artifacts, generated files and the bundled skills toolchain are never lint targets
  { ignores: ["**/.next/**", "**/node_modules/**", "next-env.d.ts", "public/**", "skills/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // the console kernel logs through the store/route layer, not console.*
      "no-console": "off",
      // `_`-prefixed args/vars are the codebase's intentional-unused convention;
      // caught errors are deliberately swallowed (documented try/catch policies)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],
    },
  },
  // one-off inspection/QA scripts run under Bun against raw DB rows; loose
  // typing and require() are idiomatic there and are not app code
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;

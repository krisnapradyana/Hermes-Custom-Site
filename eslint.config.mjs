import { FlatCompat } from "@eslint/eslintrc";

/**
 * Flat ESLint config wrapping Next.js' recommended rules (core-web-vitals
 * includes react-hooks — the exhaustive-deps suppressions in the code are
 * finally checked by a real linter).
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "out/**"],
  },
];

export default config;

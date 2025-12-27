import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  // -----------------------------
  // GLOBAL IGNORE
  // -----------------------------
  {
    ignores: [
      "**/*_DISABLED/**",
      "dist/**",
      "node_modules/**"
    ]
  },

  // -----------------------------
  // GLOBAL RULES (ENTIRE SRC)
  // -----------------------------
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { "prefer": "type-imports" }
      ],
      "@typescript-eslint/no-explicit-any": "off"
    }
  },

  // -----------------------------
  // PRODUCT LAYER (STRICT)
  // -----------------------------
  {
    files: ["src/product/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error"
    }
  },

  // -----------------------------
  // TESTS (RELAXED)
  // -----------------------------
  {
    files: ["**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];

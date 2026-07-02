import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

import noUnrewriteableStmtInTenantWrap from "./eslint-rules/no-unrewriteable-stmt-in-tenant-wrap.js";

const securelogicLocal = {
  rules: {
    "no-unrewriteable-stmt-in-tenant-wrap": noUnrewriteableStmtInTenantWrap
  }
};

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
    languageOptions: {
      parser: tsparser
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },

  // -----------------------------
  // A04-G1 γ.0 — savepoint-safety guard (route handlers only)
  // -----------------------------
  {
    files: ["src/api/routes/**/*.ts"],
    plugins: {
      "securelogic-local": securelogicLocal
    },
    rules: {
      "securelogic-local/no-unrewriteable-stmt-in-tenant-wrap": "error"
    }
  }
];

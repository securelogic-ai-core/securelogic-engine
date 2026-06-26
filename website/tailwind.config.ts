import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      maxWidth: {
        site: "1200px",
      },
      colors: {
        // ── SecureLogic AI design tokens (single source of truth) ──
        // Hex literals here (not CSS vars) so Tailwind opacity modifiers
        // like bg-accent/10 work. Mirrored as CSS vars in globals.css.
        bg: "#0a1628",
        "bg-elevated": "#0f1f35",
        "bg-elevated-2": "#12203a",
        hairline: "#1e3a5f",
        text: "#f1f5f9",
        "text-muted": "#94a3b8",
        "text-body": "#cbd5e1",
        accent: "#00c4b4",
        "accent-hover": "#14d8cb",
        success: "#22c55e",
        danger: "#ef4444",
        warning: "#f97316",

        // ── Legacy brand scales — retained for out-of-scope pages
        // (platform, intelligence-brief, security, legal). Do not use
        // these on the rebuilt index/pricing/about/contact pages.
        teal: {
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
        navy: {
          800: "#0f172a",
          900: "#0a0f1e",
        },
      },
    },
  },
  plugins: [],
};

export default config;

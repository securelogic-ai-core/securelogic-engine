import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      colors: {
        // Brand navy — dark surfaces, matches marketing website
        navy: {
          900: "#0a0f1e",
        },
        // Brand dark palette
        brand: {
          bg:      "#0a0f1a",
          surface: "#0d1b2e",
          line:    "#1e2d45",
          teal:    "#00c4b4",
        },
      },
    },
  },
  plugins: [],
};

export default config;

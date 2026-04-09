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
      },
    },
  },
  plugins: [],
};

export default config;

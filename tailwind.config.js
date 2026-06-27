/** @type {import('tailwindcss').Config} */
// JARVIS 美学 (§6): ダーク基調 #0E1116 + 低彩度シアン/ティール、状態色 緑/黄/赤。
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          900: "#0E1116",
          850: "#12161D",
          800: "#171C24",
          700: "#1F2630",
          600: "#2A323E",
          500: "#3A4452",
        },
        accent: {
          DEFAULT: "#3FB5B0",
          soft: "#2E7D7A",
          dim: "#1E4F4D",
        },
        ok: "#4ADE80",
        warn: "#FBBF24",
        down: "#F87171",
        muted: "#8A94A6",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "sans-serif"],
        mono: ["SFMono-Regular", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

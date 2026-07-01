/** @type {import('tailwindcss').Config} */
// AirFlow Design Spec v1.0: dark cockpit tokens + low-saturation cyan/teal.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          900: "#0E1116",
          850: "#141922",
          800: "#1A212C",
          750: "#1F2733",
          700: "#242D3A",
          600: "#2B3543",
          500: "#5D6B7B",
        },
        accent: {
          DEFAULT: "#4EA1FF",
          soft: "#7BB9FF",
          dim: "rgba(78,161,255,.14)",
          border: "rgba(78,161,255,.4)",
        },
        teal: "#3FD8C8",
        ok: "#3ED07E",
        warn: "#F2C14E",
        down: "#F26D6D",
        purple: "#8B7CFF",
        text1: "#E6EDF3",
        text2: "#98A6B6",
        muted: "#5D6B7B",
      },
      fontFamily: {
        display: ["Space Grotesk", "IBM Plex Sans", "system-ui", "sans-serif"],
        sans: ["IBM Plex Sans", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

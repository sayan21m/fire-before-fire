/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./data/index.html", "./data/scripts.js"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0B1220",
          raised: "#111A2B",
          card: "#151F30",
          hover: "#1A2538",
          border: "#243044",
        },
        accent: { DEFAULT: "#3B82F6", soft: "#1E3A5F", muted: "#60A5FA" },
        success: { DEFAULT: "#22C55E", soft: "#14532D", muted: "#4ADE80" },
        warning: { DEFAULT: "#F59E0B", soft: "#78350F", muted: "#FBBF24" },
        danger: { DEFAULT: "#EF4444", soft: "#7F1D1D", muted: "#F87171" },
        ink: { DEFAULT: "#F1F5F9", muted: "#94A3B8", dim: "#64748B" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glass: "0 8px 32px rgba(0,0,0,0.35)",
        glow: "0 0 24px rgba(59,130,246,0.15)",
        "glow-danger": "0 0 20px rgba(239,68,68,0.25)",
      },
      keyframes: {
        pulseLive: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.85)" },
        },
        blinkAlert: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        skeleton: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        pulseLive: "pulseLive 2s ease-in-out infinite",
        blinkAlert: "blinkAlert 1.2s ease-in-out infinite",
        fadeIn: "fadeIn 0.35s ease-out",
        slideIn: "slideIn 0.3s ease-out",
        skeleton: "skeleton 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

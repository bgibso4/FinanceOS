/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--background))",
        foreground: "rgb(var(--foreground))",
        muted: "rgb(var(--muted))",
        card: "rgb(var(--card))",
        "card-foreground": "rgb(var(--card-foreground))",
        accent: "rgb(var(--accent))"
      },
      borderRadius: {
        xl: "1rem"
      },
      boxShadow: {
        card: "0 10px 40px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.html"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#F64668", dark: "#984063" } },
      spacing: { 18: "4.5rem" },
      borderRadius: { card: "14px" },
      screens: { tablet: "900px" },
    },
  },
};

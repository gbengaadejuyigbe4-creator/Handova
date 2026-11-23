/** @type {import('tailwindcss').Config} */

// Handova design tokens.
//
// Colour meaning (keep it this way):
//   teal    = the app's one action colour (deep "scrub" green): buttons, selected states, links
//   indigo  = steel blue, used for AI-generated and planning content
//   amber   = caution          red = critical          green = stable
// Colour names teal/indigo are kept so existing class names keep working.
//
// Type: Atkinson Hyperlegible Next, designed for low-vision legibility. It suits tired eyes,
// small phone screens and night shifts. It is bundled with the app, so it works offline.
const FONT = ['"Atkinson Hyperlegible Next Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'];

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}", "!./src/utils/emrExtract.ts"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { display: FONT, body: FONT, mono: FONT },
      colors: {
        navy: { 950: '#010C1A', 900: '#021428', 800: '#042038', 700: '#073260' },
        teal: {
          50: '#EAF4F1', 100: '#D3E8E2', 200: '#AACFC4', 300: '#7BB3A4', 400: '#4A9483',
          500: '#1F7A65', 600: '#0E5A49', 700: '#0A4638', 800: '#073A2F', 900: '#052C24', 950: '#031A15',
        },
        indigo: {
          50: '#EEF3F9', 100: '#DCE7F3', 200: '#B9CFE6', 300: '#8FB0D4', 400: '#5E8BBC',
          500: '#3B6EA5', 600: '#2A5788', 700: '#1F446C', 800: '#17344F', 900: '#112841', 950: '#0A1A2B',
        },
        dark: { bg: '#0F161D', surface: '#16202A', hover: '#1B2733', border: '#3B4C5C' },
      },
      borderRadius: { xl: '10px', '2xl': '12px', '3xl': '14px' },
      boxShadow: {
        sm: '0 1px 0 rgba(20, 32, 43, 0.04)',
        DEFAULT: '0 1px 2px rgba(20, 32, 43, 0.06)',
        md: '0 2px 8px rgba(20, 32, 43, 0.08)',
        lg: '0 6px 18px rgba(20, 32, 43, 0.12)',
        xl: '0 10px 28px rgba(20, 32, 43, 0.14)',
        '2xl': '0 14px 36px rgba(20, 32, 43, 0.16)',
        glass: 'none', 'glass-dark': 'none', glow: 'none', 'glow-primary': 'none',
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        'app-dark': '#0f172a',
        'app-darker': '#020617',
        'app-panel': '#1e293b',
        'app-border': '#334155',
        'app-accent': '#3b82f6',
        'app-purple': '#8b5cf6',
        'app-green': '#10b981',
        'app-red': '#ef4444',
        'app-yellow': '#f59e0b',
        'app-cyan': '#06b6d4',
      },
      fontFamily: {
        'sans': ['Roboto'],
        'mono': ['Roboto'],
        'inter': ['Roboto'],
      }
    },
  },
  plugins: [],
}

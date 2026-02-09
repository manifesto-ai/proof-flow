/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: {
    relative: true,
    files: [
      './index.html',
      './src/**/*.{ts,tsx}'
    ]
  },
  theme: {
    extend: {
      colors: {
        border: 'hsl(217 33% 24%)',
        input: 'hsl(217 33% 24%)',
        ring: 'hsl(199 89% 48%)',
        background: 'hsl(222 47% 6%)',
        foreground: 'hsl(210 40% 98%)',
        primary: {
          DEFAULT: 'hsl(199 89% 48%)',
          foreground: 'hsl(210 40% 98%)'
        },
        secondary: {
          DEFAULT: 'hsl(217 33% 17%)',
          foreground: 'hsl(210 40% 98%)'
        }
      }
    }
  },
  plugins: []
}

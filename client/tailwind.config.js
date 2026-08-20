/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          400: '#5b8cff',
          500: '#3b6bf0',
          600: '#2c52c9',
          700: '#233f9c',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

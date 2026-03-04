/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'bg-cream':   '#F1E3C6',
        'bg-rose':    '#EDE8DF',
        'bg-mint':    '#DFF0E6',
        // Text
        'text-forest':  '#3E5E52',
        'text-sage':    '#6D9B8A',
        'text-purple':  '#5F5476',
        'text-mauve':   '#8E7A9B',
        // Actions + Accents
        'primary':          '#4A9B7F',
        'secondary':        '#5B9FAA',
        'accent-lavender':  '#9B8FC4',
        'accent-amber':     '#D4A056',
        // Blues (selective use)
        'blue-navy':    '#1F234A',
        'blue-slate':   '#404371',
        'blue-steel':   '#687495',
        'blue-powder':  '#B0C5DD',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body:    ['Nunito', 'sans-serif'],
      },
      borderRadius: {
        'xl':  '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'bg-base': 'color-mix(in srgb, var(--bg-base) calc(<alpha-value> * 100%), transparent)',
        'bg-surface':
          'color-mix(in srgb, var(--bg-surface) calc(<alpha-value> * 100%), transparent)',
        'bg-card': 'color-mix(in srgb, var(--bg-card) calc(<alpha-value> * 100%), transparent)',
        'bg-elevated':
          'color-mix(in srgb, var(--bg-elevated) calc(<alpha-value> * 100%), transparent)',
        'text-primary':
          'color-mix(in srgb, var(--text-primary) calc(<alpha-value> * 100%), transparent)',
        'text-secondary':
          'color-mix(in srgb, var(--text-secondary) calc(<alpha-value> * 100%), transparent)',
        'text-muted':
          'color-mix(in srgb, var(--text-muted) calc(<alpha-value> * 100%), transparent)',
        accent: 'color-mix(in srgb, var(--accent) calc(<alpha-value> * 100%), transparent)',
        green: 'color-mix(in srgb, var(--green) calc(<alpha-value> * 100%), transparent)',
        red: 'color-mix(in srgb, var(--red) calc(<alpha-value> * 100%), transparent)',
        'tag-blue': 'color-mix(in srgb, var(--tag-blue) calc(<alpha-value> * 100%), transparent)',
        'tag-green': 'color-mix(in srgb, var(--tag-green) calc(<alpha-value> * 100%), transparent)',
        'tag-red': 'color-mix(in srgb, var(--tag-red) calc(<alpha-value> * 100%), transparent)',
        'tag-yellow':
          'color-mix(in srgb, var(--tag-yellow) calc(<alpha-value> * 100%), transparent)',
        'tag-purple':
          'color-mix(in srgb, var(--tag-purple) calc(<alpha-value> * 100%), transparent)',
        'tag-pink': 'color-mix(in srgb, var(--tag-pink) calc(<alpha-value> * 100%), transparent)',
        'tag-indigo':
          'color-mix(in srgb, var(--tag-indigo) calc(<alpha-value> * 100%), transparent)',
        'tag-orange':
          'color-mix(in srgb, var(--tag-orange) calc(<alpha-value> * 100%), transparent)',
        'tag-teal': 'color-mix(in srgb, var(--tag-teal) calc(<alpha-value> * 100%), transparent)',
      },
      borderRadius: {
        xl: '1rem',
      },
      boxShadow: {
        card: 'var(--card-shadow)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

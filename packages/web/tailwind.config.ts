import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#232328',
          deep: '#1a1a1e',
          raised: '#2a2a30',
          overlay: '#32323a',
        },
        border: {
          DEFAULT: '#3a3a42',
          subtle: '#2e2e36',
        },
        accent: {
          DEFAULT: '#d4714e',
          hover: '#e07d58',
          muted: '#d4714e20',
        },
        warm: {
          DEFAULT: '#c4956a',
          muted: '#c4956a20',
        },
        claude: {
          DEFAULT: '#9b7ddb',
          hover: '#a98ae3',
          muted: '#9b7ddb20',
        },
        text: {
          DEFAULT: '#e8e4e0',
          secondary: '#9a9690',
          muted: '#6a665f',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

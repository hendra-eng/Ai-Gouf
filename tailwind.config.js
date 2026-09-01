/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        positive: 'var(--positive)',
        negative: 'var(--negative)',

        // Diupgrade jadi object (dari Kodingan 2) — tetap backward compatible,
        // sekaligus mendukung class -bg dan -foreground dari halaman baru
        warning: {
          DEFAULT: 'var(--warning)',
          bg: 'var(--warning-bg)',
          foreground: 'var(--warning-foreground)',
        },
        info: {
          DEFAULT: 'var(--info)',
          bg: 'var(--info-bg)',
          foreground: 'var(--info-foreground)',
        },

        ai: 'var(--ai)',

        // Ditambahkan dari halaman assets/equity/liabilities (kodingan 1)
        surface: '#111827',
        'surface-2': '#1a2235',
        'surface-3': '#1e2d42',
        'border-light': '#243044',
        onBackground: '#e2e8f0',
        onSurface: '#cbd5e1',
        'muted-light': '#94a3b8',
        success: '#10b981',
        danger: '#f43f5e',
        'accent-cyan': '#06b6d4',
        'accent-purple': '#8b5cf6',
        'accent-emerald': '#10b981',
        'accent-amber': '#f59e0b',
        'accent-rose': '#f43f5e',
        'accent-indigo': '#6366f1',

        // Token warna chart untuk 3 halaman baru (kodingan 1)
        'chart-1': 'var(--chart-1)',
        'chart-2': 'var(--chart-2)',
        'chart-3': 'var(--chart-3)',
        'chart-4': 'var(--chart-4)',
        'chart-5': 'var(--chart-5)',
        'chart-6': 'var(--chart-6)',

        // Baru dari Kodingan 2 — key berbeda dari "ai", tidak bentrok
        'ai-purple': {
          DEFAULT: 'var(--ai-purple)',
          bg: 'var(--ai-purple-bg)',
          foreground: 'var(--ai-purple-foreground)',
        },
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 4px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 4px)',
        xl: 'calc(var(--radius) + 8px)',
      },
      fontFamily: {
        sans: ['var(--font-plus-jakarta-sans)', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['15px', { lineHeight: '22px' }],
        lg: ['16px', { lineHeight: '24px' }],
        xl: ['18px', { lineHeight: '28px' }],
        '2xl': ['20px', { lineHeight: '28px' }],
        '3xl': ['24px', { lineHeight: '32px' }],
        '4xl': ['28px', { lineHeight: '36px' }],
        '5xl': ['32px', { lineHeight: '40px' }],
        '6xl': ['36px', { lineHeight: '44px' }],
      },
      boxShadow: {
        card: '0 2px 8px -1px rgba(15,23,42,0.10), 0 4px 12px -2px rgba(15,23,42,0.06)',
        'card-md': '0 8px 16px -3px rgba(15,23,42,0.13), 0 4px 8px -3px rgba(15,23,42,0.08)',
        'card-lg': '0 16px 28px -6px rgba(15,23,42,0.16), 0 8px 12px -6px rgba(15,23,42,0.08)',
        drawer: '-4px 0 24px rgba(0,0,0,0.12)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.5)',
        glow: '0 0 20px rgba(59,130,246,0.15)',
        'glow-sm': '0 0 10px rgba(59,130,246,0.1)',

        // Baru dari Kodingan 2
        dropdown: '0 4px 16px rgba(0,0,0,0.10)',
      },
      transitionDuration: {
        // Baru dari Kodingan 2
        DEFAULT: '150ms',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out forwards',
        'slide-in-right': 'slideInRight 250ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
        'pulse-update': 'pulseUpdate 600ms ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                background: {
                    DEFAULT: '#10111a', // GMX Deep Navy
                    secondary: '#16161a', // Card bg
                    tertiary: '#1f1f2e', // Hover/Input bg
                },
                text: {
                    primary: '#FFFFFF',
                    secondary: '#A0A0A0',
                    muted: '#656570',
                },
                border: {
                    DEFAULT: '#2a2a35', // Crisp border
                },
                // Primary brand colors - GMX Blue
                primary: {
                    50: '#eef2ff',
                    100: '#e0e7ff',
                    200: '#c7d2fe',
                    300: '#a5b4fc',
                    400: '#818cf8',
                    500: '#6366f1',
                    600: '#4f46e5',
                    700: '#4338ca',
                    800: '#3730a3',
                    900: '#2d42fc', // GMX Blue
                    DEFAULT: '#2d42fc',
                },
                // Dark theme backgrounds
                dark: {
                    900: '#10111a',
                    800: '#16161a',
                    700: '#1f1f2e',
                },
                // Trading colors - GMX Style
                long: {
                    DEFAULT: '#30e0a1',
                    light: '#5cf2b8',
                    dark: '#22ad79',
                },
                short: {
                    DEFAULT: '#fa3c58',
                    light: '#ff6b81',
                    dark: '#d42a44',
                },
                // Accent colors
                accent: {
                    purple: '#7928CA',
                    pink: '#FF0080',
                    cyan: '#00DFD8',
                    yellow: '#FFd700',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'Menlo', 'monospace'],
                display: ['Outfit', 'sans-serif'],
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
                'gradient-premium': 'linear-gradient(135deg, rgba(14, 165, 233, 0.1) 0%, rgba(121, 40, 202, 0.1) 100%)',
                'gradient-glow': 'radial-gradient(circle at center, rgba(14, 165, 233, 0.15), transparent 70%)',
                'glass-gradient': 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
            },
            animation: {
                'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'shimmer': 'shimmer 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'glow': 'glow 3s ease-in-out infinite alternate',
                'float': 'float 6s ease-in-out infinite',
                'slide-up': 'slideUp 0.5s ease-out',
                'fade-in': 'fadeIn 0.3s ease-out',
            },
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
                glow: {
                    '0%': { boxShadow: '0 0 10px rgba(14, 165, 233, 0.2)' },
                    '100%': { boxShadow: '0 0 25px rgba(14, 165, 233, 0.5)' },
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-10px)' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(20px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
            },
            boxShadow: {
                'glow-sm': '0 0 15px rgba(14, 165, 233, 0.15)',
                'glow': '0 0 25px rgba(14, 165, 233, 0.25)',
                'glow-lg': '0 0 40px rgba(14, 165, 233, 0.35)',
                'nav': '0 4px 30px rgba(0, 0, 0, 0.1)',
                'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
                'modal': '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            },
            fontVariantNumeric: {
                tabular: ['tabular-nums'],
            },
            spacing: {
                'section': '1.5rem',
                'section-lg': '2rem',
            },
            borderRadius: {
                'card': 'var(--radius-card)',
                'modal': 'var(--radius-modal)',
            },
            backdropBlur: {
                xs: '2px',
                xl: '20px',
            },
        },
    },
    plugins: [],
};

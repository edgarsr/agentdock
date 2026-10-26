/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'var(--ide-Panel-background)',
          secondary: 'var(--ide-background-secondary)'
        },
        foreground: {
          DEFAULT: 'var(--ide-Label-foreground)',
          secondary: 'color-mix(in srgb, var(--ide-Label-foreground), transparent 40%)'
        },
        primary: {
          DEFAULT: 'var(--ide-Button-default-startBackground)',
          foreground: 'var(--ide-Button-default-foreground)',
          border: 'var(--ide-Button-default-borderColor)',
        },
        secondary: 'var(--ide-Button-startBackground)',
        accent: {
          DEFAULT: 'var(--ide-List-selectionBackground)',
          foreground: 'var(--ide-List-selectionForeground)',
        },
        border: 'var(--ide-Borders-color)',
        'radio-border': 'color-mix(in srgb, var(--ide-Label-foreground), transparent 70%)',
        input: 'var(--ide-background-secondary)',
        editor: {
          bg: 'var(--ide-editor-bg)',
          fg: 'var(--ide-editor-fg)',
        },
        'user-message': {
          default: 'var(--ide-user-message-default-bg)',
          'blue-highlight': 'var(--ide-user-message-blue-highlight-bg)',
          blue: 'var(--ide-user-message-blue-bg)',
        },
        success: '#57965c',
        error: '#db5c5c',
        warning: '#ba9752',
        link: 'var(--ide-Hyperlink-linkColor)',
        added: {
          DEFAULT: '#368e59',
          bg: 'color-mix(in srgb, #368e59, transparent 70%)'
        },
        deleted: {
          DEFAULT: '#ed615f',
          bg: 'color-mix(in srgb, #ed615f, transparent 70%)'
        },
        syntax: {
          keyword: 'var(--ide-syntax-keyword)',
          string: 'var(--ide-syntax-string)',
          number: 'var(--ide-syntax-number)',
          comment: 'var(--ide-syntax-comment)',
          function: 'var(--ide-syntax-function)',
          class: 'var(--ide-syntax-class)',
          tag: 'var(--ide-syntax-tag)',
          attr: 'var(--ide-syntax-attr)',
        }
      },
      fontSize: {
        'ide-h1': '1.75rem',
        'ide-h2': '1.5rem',
        'ide-h3': '1.25rem',
        'ide-h4': '1.125rem',
        'ide-regular': '1rem',
        'ide-medium': '1.125rem',
        'ide-small': '0.93rem',
      },
      borderRadius: {
        'ide': '6px',
      },
      boxShadow: {
        popup: '0 6px 24px rgba(0, 0, 0, 0.35)',
      },
      maxWidth: {
        'app-content': 'var(--app-content-max-width, 760px)',
      },
      spacing: {
        'ide-paragraph': 'var(--ide-paragraph-spacing)',
        'ide-indent': 'var(--ide-list-indent)',
      },
      fontFamily: {
        mono: ['var(--ide-code-font-family)', 'monospace'],
      },
      // Deeper than Tailwind's default .5, so the grey activity dots visibly pulse.
      keyframes: {
        pulse: { '50%': { opacity: '.2' } },
      },
    },
  },
  plugins: [
    function({ addUtilities, addVariant }) {
      addVariant('chat-max-400', '@container chat-input (max-width: 400px)');
      addVariant('chat-max-600', '@container chat-input (max-width: 600px)');
      // A section popup content too narrow for the buttons beside the text.
      addVariant('section-medium', '@container section (max-width: 450px)');
      addVariant('app-wide', '#app-content[data-wide] &');
      // Touch screens: the primary pointer is a finger, so controls need larger targets.
      addVariant('touch', '@media (pointer: coarse)');
      // A row is revealed while hovered, while it holds focus, and while one of its popup menus is open.
      const revealed = [':hover', ':focus-within', ':has([aria-haspopup][aria-expanded=true])'];
      addVariant('reveal', revealed.map((state) => `&${state}`));
      addVariant('group-reveal', revealed.map((state) => `.group${state} &`));
      const tint = (percent) => ({
        'background-image': `linear-gradient(color-mix(in srgb, var(--ide-Label-foreground) ${percent}, transparent) 0 0)`,
      });
      addUtilities({
        '.bg-hover': tint('var(--ide-surface-hover-tint)'),
        '.bg-active': tint('var(--ide-surface-active-tint)'),
      })
    },
  ],
}

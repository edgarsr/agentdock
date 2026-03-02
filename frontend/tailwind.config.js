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
          secondary: 'var(--ide-Label-disabledForeground)'
        },
        primary: {
          DEFAULT: 'var(--ide-Button-default-startBackground)',
          foreground: 'var(--ide-Button-default-foreground)',
          border: 'var(--ide-Button-default-borderColor)',
        },
        secondary: {
          DEFAULT: 'var(--ide-Button-startBackground)',
          foreground: 'var(--ide-Button-foreground)',
          border: 'var(--ide-Button-borderColor)',
        },
        accent: {
          DEFAULT: 'var(--ide-List-selectionBackground)',
          foreground: 'var(--ide-List-selectionForeground)',
        },
        border: 'var(--ide-Borders-color)',
        input: 'var(--ide-TextField-background)',
        editor: {
          bg: 'var(--ide-editor-bg)',
          fg: 'var(--ide-editor-fg)',
        },
        success: '#57965c',
        error: '#db5c5c',
        warning: '#ba9752',
        link: 'var(--ide-Hyperlink-linkColor)',
        added: 'var(--ide-vcs-added)',
        deleted: 'var(--ide-vcs-deleted)',
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
        'ide-small': '0.875rem',
      },
      borderRadius: {
        'ide': '6px',
      },
      spacing: {
        'ide-paragraph': 'var(--ide-paragraph-spacing)',
        'ide-indent': 'var(--ide-list-indent)',
      }
    },
  },
  plugins: [],
}

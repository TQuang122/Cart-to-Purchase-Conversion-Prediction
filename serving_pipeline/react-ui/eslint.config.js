import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/components/ui/magnetic.tsx',
      'src/components/ui/rainbow-button.tsx',
      'src/components/ui/scroll-text.tsx',
      'src/components/ui/highlight-text.tsx',
      'src/components/ui/feedback-widget.tsx',
      'src/components/ui/animated-theme-toggle.tsx',
      'src/components/ui/code-block.tsx',
      'src/components/ui/animated-table.tsx',
      'src/components/ui/command-palette.tsx',
    ],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])

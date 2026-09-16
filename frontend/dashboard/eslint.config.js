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
      // React 19 introduces stricter hook diagnostics that are currently too
      // noisy for this codebase. Keep them visible as warnings while we
      // refactor incrementally.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      // UI primitives export helpers/types together with components.
      'react-refresh/only-export-components': 'off',
      // Transitional: reduce CI friction until typed cleanup is complete.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // O pipeline de markdown protege trechos (code spans, fences) trocando-os
    // por sentinelas `\u0000CODE0\u0000` antes de aplicar as regexes de
    // higiene, e restaura no fim. O caractere de controle é justamente o que
    // garante que a sentinela não colide com conteúdo real do usuário —
    // então `no-control-regex` aqui só aponta a técnica, não um defeito.
    files: ['src/components/Markdown/**/*.ts'],
    rules: { 'no-control-regex': 'off' },
  },
])

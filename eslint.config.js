import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

const forbiddenInPureCode = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'Pure modules must not depend on React.',
  },
  {
    group: ['**/ui', '**/ui/*', '**/storage', '**/storage/*'],
    message: 'Pure modules must not import from src/ui or src/storage.',
  },
]

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['src/core/**/*.{ts,tsx}', 'src/packing/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenInPureCode }],
    },
  },
)

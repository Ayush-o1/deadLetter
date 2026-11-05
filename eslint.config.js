import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'src/generated/', 'coverage/', 'reports/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      // The security engine must never execute generated code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Browser code (added in phase 9) runs in a different environment.
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];

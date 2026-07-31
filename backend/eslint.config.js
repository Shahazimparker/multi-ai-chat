// ============================================================
// FILE: backend/eslint.config.js
// PURPOSE: ESLint flat config (required from ESLint 9; .eslintrc
//          support was removed entirely in ESLint 10).
// ============================================================

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/', 'uploads/', 'coverage/'],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-case-declarations': 'warn',
      'no-useless-escape': 'warn',

      // New to eslint:recommended in ESLint 10. They flag 13 pre-existing
      // spots across services/ — all reviewed as style-level (redundant
      // initialisers, dead stores before `break`, rethrows without `cause`),
      // none a live defect. Kept visible as warnings pending a cleanup pass
      // rather than silenced or bulk-edited.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },

  {
    // Vitest runs with globals: true, so the test globals are ambient.
    // They are Jest-compatible apart from `vi`, which has no globals entry.
    files: ['__tests__/**/*.js', 'vitest.config.js', 'vitest.real.config.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        vi: 'readonly',
      },
    },
  },
];

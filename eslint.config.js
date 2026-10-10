'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'web/assets/tinycon.min.js',
      'web/assets/ansi_up.js',
      'web/assets/bootstrap*',
    ],
  },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.mocha } },
  },
  {
    files: ['web/assets/app.js', 'web/assets/init.js', 'web/assets/formats.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, io: 'readonly' },
    },
    rules: { 'no-var': 'off', 'prefer-const': 'off' },
  },
];

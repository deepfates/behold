const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.behold-runtime/**',
      '.behold-runs/**',
      '.behold-entities/**',
      '.behold-artifacts/**',
      '**/*.ts',
    ],
  },
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];

module.exports = {
  root: true,

  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/typescript',
    'plugin:import/recommended',
    'plugin:jest/recommended',
    'plugin:jest/style',

    // The prettier config must be last, since it overrides (and disables) rules
    // that are "unnecessary or might conflict with Prettier".
    'prettier',
  ],

  rules: {
    'no-console': 'error',
    'import/named': 'off',
    'import/no-named-as-default': 'off', // very noisy and not always desirable
    'import/order': [
      'error',
      {
        alphabetize: {
          order: 'asc',
        },
        'newlines-between': 'always',
      },
    ],
    'jest/expect-expect': [
      'error',
      {
        assertFunctionNames: [
          'expect',
          '*.has*',
          '*.resourceCountIs',
          '*.templateMatches',
        ],
      },
    ],
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        ignoreRestSiblings: true,
      },
    ],
    '@typescript-eslint/unbound-method': 'error',
  },

  env: {
    node: true,
  },

  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json', './packages/*/tsconfig.json'],
    sourceType: 'module',
  },

  settings: {
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
      },
    },
  },

  overrides: [
    // Swap `unbound-method` implementations in tests
    {
      files: ['**/__tests__/**', '*.test.ts'],
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        'jest/unbound-method': 'error',
      },
    },
  ],

  ignorePatterns: ['**/dist'],
};

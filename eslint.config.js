import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import cyclomaticPlugin from 'eslint-plugin-cyclomatic-complexity';
import noNestedTry from './eslint-rules/no-nested-try.js';
import noInlineEnoentCheck from './eslint-rules/no-inline-enoent-check.js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
      },
      globals: {
        Bun: 'readonly',
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettierPlugin,
      'cyclomatic-complexity': cyclomaticPlugin,
      local: {
        rules: { 'no-nested-try': noNestedTry, 'no-inline-enoent-check': noInlineEnoentCheck },
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-undef': 'off',
      'cyclomatic-complexity/zee-codeBlockComplexity': 'error',
      'local/no-nested-try': 'error',
      'local/no-inline-enoent-check': 'error',
    },
  },
  {
    files: ['src/frontend/**/*.ts', 'src/frontend/**/*.tsx'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/frontend/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*/frontend/scripts/*'],
              message:
                'Domain/loader/handler code must not import from frontend scripts. Move shared types to src/schemas/ instead.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      'public',
      'eslint-rules',
      'mirror',
      'src/db/source/goldenSeed.ts',
    ],
  },
];

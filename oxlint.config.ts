import { defineConfig } from 'oxlint'

export default defineConfig({
  $schema: './node_modules/oxlint/configuration_schema.json',

  ignorePatterns: [
    '**/node_modules/',
    'dist/',
    'quasar.config.*.temporary.compiled*',
    '.quasar/',
    'src-cordova/',
    'src-capacitor/',
    'src/router/typed-router.d.ts',
    'reference/',
    'docs/',
    '.claude/',
    '.playwright-mcp/',
    'test-results/',
    'playwright-report/'
  ],

  options: {
    typeAware: true,
    typeCheck: true,
    maxWarnings: 10
  },

  plugins: ['typescript', 'vue', 'import', 'eslint', 'promise', 'unicorn'],

  // correctness/suspicious catch real bugs and are safe to blanket-enable.
  // oxlint's "style"/"pedantic"/"restriction" categories were tried and
  // rejected: they pull in rules with no equivalent in JavaScript Standard
  // Style and that actively fight normal Vue/TS code (capitalized-comments,
  // sort-keys, sort-imports, func-style, no-ternary, id-length, one-var),
  // some of which directly contradict each other file-to-file
  // (import/no-named-export vs import/prefer-default-export). The actual
  // "standard" surface is opted into explicitly below instead.
  categories: {
    correctness: 'error',
    suspicious: 'error'
    // style: 'warn',
    // pedantic: 'warn',
    // restriction: 'warn',
    // perf: 'warn'
  },

  // JavaScript Standard Style (eslint-config-standard) parity: these rules
  // are the substantive, non-formatting core of "standard" (formatting is
  // oxfmt's job: semi:false, singleQuote:true). Pinned to "error" explicitly
  // so they hold even if the categories above change.
  rules: {
    eqeqeq: 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'no-throw-literal': 'error',
    'no-array-constructor': 'error',
    'object-shorthand': 'error',
    'no-use-before-define': [
      'error',
      { functions: false, classes: false, variables: true }
    ],
    'no-return-assign': 'error',
    'no-sequences': 'error',
    'no-self-compare': 'error',
    'no-unneeded-ternary': 'error',
    'no-useless-call': 'error',
    'no-useless-constructor': 'error',
    'no-useless-rename': 'error',
    'no-useless-computed-key': 'error',
    'no-new-wrappers': 'error',
    'no-extend-native': 'error',
    'no-implied-eval': 'error',
    'no-eval': 'error',
    'no-proto': 'error',
    'no-iterator': 'error',
    'no-labels': 'error',
    'no-lone-blocks': 'error',
    'no-caller': 'error',
    // Every use in this codebase sorts a freshly-derived local array
    // (.filter()/.map() output or a literal), so in-place mutation is safe.
    // `.toSorted()` isn't usable as the replacement: this toolchain's
    // type-aware checker doesn't see the ES2023 lib target it needs.
    'unicorn/no-array-sort': 'off'
  },

  env: {
    builtin: true
  },

  overrides: [
    {
      // node:test's `test(name, fn)` returns a Promise that Node itself
      // awaits internally via the test runner — not awaiting/void-ing it at
      // the call site is the standard, correct usage, not a bug. Casts on
      // `unknown`-typed Fastify/DB return values are also normal in tests.
      files: ['tests/**/*.test.ts'],
      rules: {
        'typescript/no-floating-promises': 'off',
        'typescript/unbound-method': 'off',
        'typescript/no-unsafe-type-assertion': 'off'
      }
    },
    {
      // node:sqlite's `DatabaseSync.prepare().get()/.all()` returns an
      // untyped row shape by design — casting to a known row interface at
      // this SQL boundary is the standard, unavoidable pattern here.
      files: ['src/server/db/**', 'src/server/repositories/**'],
      rules: {
        'typescript/no-unsafe-type-assertion': 'off'
      }
    }
  ]
})

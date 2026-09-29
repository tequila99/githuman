import { describe, it } from 'node:test'
import { RuleTester } from 'oxlint/plugins-dev'
import plugin from '../../lint-rules/curly-if-else.js'

// RuleTester has no test runner of its own.
RuleTester.describe = describe
RuleTester.it = it

new RuleTester().run('curly-if-else', plugin.rules['curly-if-else'], {
  valid: [
    'if (a) b()',
    'function f(a) { if (a) return }',
    'if (a) {\n  b()\n} else {\n  c()\n}',
    'if (a) {\n  b()\n} else if (c) {\n  d()\n} else {\n  e()\n}',
    'if (a) {\n  b()\n} else if (c) {\n  d()\n}',
    'for (const x of xs) if (x) b()'
  ],
  invalid: [
    {
      name: 'no braces on either branch',
      code: 'if (a) b()\nelse c()',
      output: 'if (a) { b() }\nelse { c() }',
      errors: 2
    },
    {
      name: 'braces on one branch only',
      code: 'if (a) b()\nelse {\n  c()\n}',
      output: 'if (a) { b() }\nelse {\n  c()\n}',
      errors: 1
    },
    {
      name: 'tail of an else-if chain',
      code: 'if (a) {\n  b()\n} else if (c) d()',
      output: 'if (a) {\n  b()\n} else if (c) { d() }',
      errors: 1
    },
    {
      name: 'every link of an unbraced chain',
      code: 'if (a) b()\nelse if (c) d()\nelse e()',
      output: 'if (a) { b() }\nelse if (c) { d() }\nelse { e() }',
      errors: 3
    }
  ]
})

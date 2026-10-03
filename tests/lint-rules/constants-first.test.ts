import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RuleTester } from 'oxlint/plugins-dev'
import plugin from '../../lint-rules/index.js'

// RuleTester has no test runner of its own.
RuleTester.describe = describe
RuleTester.it = it

new RuleTester().run('constants-first', plugin.rules['constants-first'], {
  valid: [
    'const MAX = 1\nfunction f() {}',
    "import a from 'a'\nconst MAX = 1\nconst LIMIT = 2\nfunction f() {}",
    {
      code: 'interface Options {}\nconst MAX = 1\nfunction f() {}',
      filename: 'test.ts'
    },
    {
      code: 'function f() {}\ninterface Options {}\ntype Mode = 1',
      filename: 'test.ts'
    },
    'function f() {}\nconst limit = 1',
    'function f() {}\nconst Max = 1',
    'function f() {\n  const MAX = 1\n}',
    'function f() {}\nlet MAX = 1',
    'export const MAX = 1\nexport function f() {}',
    'const MAX = 1\nexport default function f() {}',
    'function f() {}\nconst HANDLERS = () => {}',
    'const MAX = 1\nconst rows = computed(() => [])',
    'const LIMIT = getLimit()\nconst MAX = 1',
    'const LIMIT = getLimit()\nconst state = ref(0)',
    'export const LIMIT = getLimit()\nconst MAX = 1',
    'const SETTINGS = { limit: getLimit() }\nconst MAX = 1',
    'function run() { const state = ref(0); const MAX = 1 }'
  ],
  invalid: [
    ...[
      'const state = ref(0)',
      'const store = useStore()',
      'const { t } = useI18n()',
      'watch(source, handler)',
      'initialize()',
      'service.initialize()',
      'service?.initialize()',
      'const state = enabled ? initialize() : null',
      'const state = await initialize()',
      'const state = initialize() as State',
      'const state = ref(0), MAX = 1'
    ].map(code => ({
      name: `a constant after initialization: ${code}`,
      code: code.endsWith('MAX = 1') ? code : `${code}\nconst MAX = 1`,
      filename: 'test.ts',
      errors: 1
    })),
    {
      name: 'a factory-initialized constant after initialization',
      code: 'const state = ref(0)\nconst LIMIT = getLimit()',
      errors: 1
    },
    {
      name: 'a constant after a computed callback',
      code: "const rows = computed(() => [])\nconst PREFIX = { added: '+' } as const",
      filename: 'test.ts',
      errors: 1
    },
    {
      name: 'a constant after a watch callback',
      code: 'watch(open, () => {})\nconst MAX = 1',
      errors: 1
    },
    {
      name: 'a constant after a nested callback factory',
      code: 'const run = wrap(computed(() => []))\nconst MAX = 1',
      errors: 1
    },
    {
      name: 'a constant between two functions',
      code: 'function a() {}\nconst MAX = 1\nfunction b() {}',
      errors: 1
    },
    {
      name: 'a constant after an arrow function',
      code: 'const run = () => {}\nconst MAX = 1',
      errors: 1
    },
    {
      name: 'a constant after a function expression',
      code: 'const run = function () {}\nconst MAX = 1',
      errors: 1
    },
    {
      name: 'a constant after a function wrapped in a type assertion',
      code: 'const run = (() => {}) as () => void\nconst MAX = 1',
      filename: 'test.ts',
      errors: 1
    },
    {
      name: 'an exported constant after a function',
      code: 'function f() {}\nexport const MAX = 1',
      errors: 1
    },
    {
      name: 'a constant after an exported function',
      code: 'export function f() {}\nconst MAX = 1',
      errors: 1
    },
    {
      name: 'a constant after a default-exported function',
      code: 'export default function f() {}\nconst MAX = 1',
      errors: 1
    },
    {
      name: 'every constant of a declaration is reported',
      code: 'function f() {}\nconst A = 1, B_2 = 2',
      errors: 2
    }
  ]
})

it('checks constants in Vue script setup through the oxlint CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'githuman-constants-first-'))
  const filename = join(directory, 'Component.vue')
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
  const lint = () =>
    spawnSync(
      process.execPath,
      [
        join(projectRoot, 'node_modules/oxlint/bin/oxlint'),
        '--config',
        join(projectRoot, 'oxlint.config.ts'),
        filename
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    )

  try {
    writeFileSync(
      filename,
      `<script setup lang="ts">
import { ref } from 'vue'
const rows = ref([])
const PREFIX = { added: '+' } as const
</script>
<template><div>{{ PREFIX.added }}{{ rows }}</div></template>`
    )
    const invalid = lint()
    assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr)
    assert.match(
      invalid.stdout + invalid.stderr,
      /local\(constants-first\).*Constant PREFIX/
    )

    writeFileSync(
      filename,
      `<script setup lang="ts">
import { ref } from 'vue'
const PREFIX = { added: '+' } as const
const rows = ref([])
</script>
<template><div>{{ PREFIX.added }}{{ rows }}</div></template>`
    )
    const valid = lint()
    assert.equal(valid.status, 0, valid.stdout + valid.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// Code that uses many grammar rules. Shiki compiles a rule on its first match, so a
// warm-up with this code makes the first real file as fast as the next ones.
const SCRIPT_SAMPLE = `import { ref, type Ref } from 'vue'
import * as path from 'node:path'
// A comment with a TODO and a URL: https://example.com
/** JSDoc with a {@link link} and @param tag */
export interface Item<T extends object = {}> {
  readonly id: number
  name?: string | null
  tags: Array<Record<string, T>>
}
export enum Mode { Fast = 1, Slow = 'slow' }
@decorator()
export default class Store<T> extends Base implements Item {
  private static count = 0n
  #secret: unknown = /ab+c/gi.test('x')
  constructor(public readonly id: number, protected items: Map<string, T> = new Map()) {
    super()
  }
  async *load(this: Store<T>, ...rest: string[]): AsyncGenerator<number, void> {
    const value = (await fetch(\`/api/\${this.id}?q=\${rest.join(',')}\`)).json() as unknown as T
    for (const [key, item] of this.items) {
      if (key === 'a' && item !== undefined) continue
      else if (!key) { throw new TypeError("bad \${key}") }
      switch (typeof item) { case 'string': break; default: yield 1.5e3 }
    }
    try { return } catch (err: unknown) { console.error(err) } finally { void 0 }
  }
}
export const handler = <K extends keyof Item>(key: K): Item[K] | undefined => items.get(key)?.[key] ?? null
type Mapped = { [P in keyof Item]?: Item[P] extends string ? P : never }
`

const STYLE_SAMPLE = `@use 'sass:math';
$gap: 8px;
// A comment
.card:not(.card--open) > .title, a[href^='http']::after {
  --accent: #1976d2;
  margin: math.div($gap, 2) auto calc(100% - #{$gap});
  background: linear-gradient(to right, rgba(0, 0, 0, 0.5), var(--accent) 50%);
  font: 600 1.2rem/1.4 'Inter', sans-serif !important;
  @media (min-width: 600px) and (prefers-color-scheme: dark) { display: none; }
  &:hover { transition: color .2s ease-in-out; }
}
@mixin box($size: 10px) { width: $size; height: $size; }
`

const HTML_SAMPLE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Sample</title></head>
<body class="app" data-id="1">
  <!-- A comment -->
  <a href="https://example.com" @click.prevent="open(item)" :class="{ active: on }">Link &amp; text</a>
  <input v-model="text" disabled />
</body>
</html>
`

const VUE_SAMPLE = `<script setup lang="ts">
import { computed, ref } from 'vue'
const props = withDefaults(defineProps<{ title: string; items?: string[] }>(), { items: () => [] })
const emit = defineEmits<{ (e: 'pick', value: string): void }>()
const count = ref(0)
const label = computed(() => \`\${props.title}: \${count.value}\`)
</script>

<template>
  <q-list v-if="items.length > 0" class="list" @click="emit('pick', label)">
    <q-item v-for="(item, index) in items" :key="item" :class="{ active: index === 0 }">
      {{ item }} <!-- row -->
    </q-item>
  </q-list>
  <p v-else>{{ $t('empty') }}</p>
</template>

<style scoped lang="scss">
.list { margin: 0 auto; &:hover { color: var(--accent); } }
</style>
`

const MARKDOWN_SAMPLE = `# Title

Some *emphasis*, **strong** text, \`inline code\` and a [link](https://example.com).

- First item
- Second item with ![image](a.png)

> A quote

1. Step one
2. Step two

| Name | Value |
| ---- | ----- |
| a    | 1     |

\`\`\`ts
const answer: number = 42
\`\`\`
`

const SAMPLES: Record<string, string> = {
  vue: VUE_SAMPLE,
  css: STYLE_SAMPLE,
  scss: STYLE_SAMPLE,
  html: HTML_SAMPLE,
  markdown: MARKDOWN_SAMPLE,
  typescript: SCRIPT_SAMPLE,
  javascript: SCRIPT_SAMPLE,
  tsx: SCRIPT_SAMPLE,
  jsx: SCRIPT_SAMPLE
}

/** Lines of code that warm up the grammar of this language. Else one short line. */
export function warmupLines(lang: string): string[] {
  return (SAMPLES[lang] ?? 'x').split('\n')
}

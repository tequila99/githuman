// One plugin, several rules: oxlint refuses two plugins that share a name
// (`Plugin name 'local' is already registered`).
import constantsFirst from './constants-first.js'
import curlyIfElse from './curly-if-else.js'

export default {
  meta: { name: 'local' },
  rules: {
    'constants-first': constantsFirst,
    'curly-if-else': curlyIfElse
  }
}

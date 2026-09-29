// Local oxlint JS plugin. The built-in `curly` can't express "braces only
// when there is an else": "all" also forbids `if (x) return`, and
// ["multi-line", "consistent"] lets `if (a) x()` / `else y()` through.

/**
 * Wraps a branch in braces; oxfmt then puts them on their own lines. An
 * unbraced if/else nested in an unbraced branch has overlapping fixes, so
 * oxlint --fix applies the outer one and a second `pnpm run lint` the rest.
 */
function reportUnbraced(context, node) {
  context.report({
    node,
    messageId: 'missingBraces',
    fix: fixer => [
      fixer.insertTextBefore(node, '{ '),
      fixer.insertTextAfter(node, ' }')
    ]
  })
}

// oxlint exports no Rule type yet; borrow the one RuleTester.run() expects.
/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const curlyIfElse = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require braces on every branch of an if that has an else (#49).'
    },
    fixable: 'code',
    schema: [],
    messages: {
      missingBraces: 'An if with an else needs braces on every branch.'
    }
  },
  create(context) {
    return {
      IfStatement(node) {
        // The tail of an else-if chain has no else of its own, but still
        // belongs to one.
        const inChain =
          node.alternate !== null ||
          (node.parent.type === 'IfStatement' && node.parent.alternate === node)
        if (!inChain) return

        if (node.consequent.type !== 'BlockStatement') {
          reportUnbraced(context, node.consequent)
        }
        const alternate = node.alternate
        if (
          alternate !== null &&
          alternate.type !== 'BlockStatement' &&
          alternate.type !== 'IfStatement'
        ) {
          reportUnbraced(context, alternate)
        }
      }
    }
  }
}

export default {
  meta: { name: 'local' },
  rules: { 'curly-if-else': curlyIfElse }
}

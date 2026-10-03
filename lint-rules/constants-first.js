// Local oxlint JS plugin rule. No built-in rule says "module constants go
// above the functions": `no-use-before-define` only catches a use that comes
// before the declaration, and a constant that sits between two functions
// passes it.

const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/

const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'ParenthesizedExpression'
])

/** `export const X = …` and `export default function f() {}` carry their declaration inside. */
function unwrapExport(statement) {
  return statement.type === 'ExportNamedDeclaration' ||
    statement.type === 'ExportDefaultDeclaration'
    ? statement.declaration
    : statement
}

function stripWrappers(expression) {
  let current = expression
  while (current !== null && WRAPPERS.has(current.type)) {
    current = current.expression
  }
  return current
}

function isFunctionInit(init) {
  const value = stripWrappers(init)
  return (
    value !== null &&
    (value.type === 'ArrowFunctionExpression' ||
      value.type === 'FunctionExpression')
  )
}

function containsCall(node, visitorKeys) {
  if (node === null || node === undefined) return false
  if (node.type === 'CallExpression') return true
  // Calls inside a function body run later, not during module initialization.
  if (isFunctionInit(node)) return false
  return (visitorKeys[node.type] ?? []).some(key => {
    const child = node[key]
    return Array.isArray(child)
      ? child.some(item => containsCall(item, visitorKeys))
      : containsCall(child, visitorKeys)
  })
}

// oxlint exports no Rule type yet; borrow the one RuleTester.run() expects.
/** @type {Parameters<import('oxlint/plugins-dev').RuleTester['run']>[1]} */
const constantsFirst = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require module-level UPPER_SNAKE constants before functions and runtime function calls.'
    },
    schema: [],
    messages: {
      constantAfterInitialization:
        'Constant {{name}} must be declared before functions and runtime function calls.'
    }
  },
  create(context) {
    return {
      Program(program) {
        let seenInitialization = false
        const { visitorKeys } = context.sourceCode
        for (const statement of program.body) {
          const declaration = unwrapExport(statement)
          if (declaration === null || declaration === undefined) continue
          if (declaration.type === 'FunctionDeclaration') {
            seenInitialization = true
            continue
          }
          if (declaration.type !== 'VariableDeclaration') {
            if (containsCall(declaration, visitorKeys))
              seenInitialization = true
            continue
          }
          for (const declarator of declaration.declarations) {
            const functionInit = isFunctionInit(declarator.init)
            const constant =
              declaration.kind === 'const' &&
              declarator.id.type === 'Identifier' &&
              CONSTANT_NAME.test(declarator.id.name) &&
              !functionInit
            if (constant) {
              if (seenInitialization) {
                context.report({
                  node: declarator.id,
                  messageId: 'constantAfterInitialization',
                  data: { name: declarator.id.name }
                })
              }
            } else if (
              functionInit ||
              containsCall(declarator.init, visitorKeys)
            ) {
              seenInitialization = true
            }
          }
        }
      }
    }
  }
}

export default constantsFirst

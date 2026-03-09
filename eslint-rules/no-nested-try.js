/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow nested try statements within the same function',
    },
    schema: [],
    messages: {
      noNestedTry: 'Nested try statements are not allowed within the same function.',
    },
  },
  create(context) {
    // Stack of try-nesting depths, one entry per function scope.
    // Initialised with [0] to handle top-level (module-scope) try statements.
    const tryDepthStack = [0];

    function enterFunction() {
      tryDepthStack.push(0);
    }

    function exitFunction() {
      tryDepthStack.pop();
    }

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      'FunctionExpression:exit': exitFunction,
      'ArrowFunctionExpression:exit': exitFunction,

      TryStatement(node) {
        const depth = tryDepthStack[tryDepthStack.length - 1];
        if (depth > 0) {
          context.report({ node, messageId: 'noNestedTry' });
        }
        tryDepthStack[tryDepthStack.length - 1]++;
      },

      'TryStatement:exit'() {
        tryDepthStack[tryDepthStack.length - 1]--;
      },
    };
  },
};

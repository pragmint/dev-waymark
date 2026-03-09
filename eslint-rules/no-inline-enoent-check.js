/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow inline ENOENT error code checks — use isEnoentError() instead',
    },
    schema: [],
    messages: {
      noInlineEnoentCheck:
        'Inline ENOENT check detected. Use isEnoentError(error) from src/loaders/isEnoentError.ts instead.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== '===') return;

        const isEnoentLiteral = n => n.type === 'Literal' && n.value === 'ENOENT';
        const isCodeAccess = n =>
          n.type === 'MemberExpression' &&
          n.property.type === 'Identifier' &&
          n.property.name === 'code';

        if (
          (isEnoentLiteral(node.right) && isCodeAccess(node.left)) ||
          (isEnoentLiteral(node.left) && isCodeAccess(node.right))
        ) {
          context.report({ node, messageId: 'noInlineEnoentCheck' });
        }
      },
    };
  },
};

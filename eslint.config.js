// ESLint (flat config) for component files, used by test/invariants/format.test.js (FMT-03): the React rules and the
// hooks rules over files napkin wrote. It does not lint napkin's own code.
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, 'react-hooks': hooks },
    settings: { react: { version: '19' } },
    rules: { ...react.configs.flat.recommended.rules, ...react.configs.flat['jsx-runtime'].rules, 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
];

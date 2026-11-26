import firebaseRules from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'android/**/*'],
  },
  firebaseRules.configs['flat/recommended'],
];

module.exports = {
  env: {
    es2021: true,
    node: true
  },
  extends: ['standard'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'space-before-function-paren': 0,
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error']
  }
}

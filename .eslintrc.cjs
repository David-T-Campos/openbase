module.exports = {
    root: true,
    ignorePatterns: ['node_modules/', 'dist/', '.next/', 'coverage/'],
    env: {
        browser: true,
        es2022: true,
        node: true,
    },
    extends: ['eslint:recommended'],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    overrides: [
        {
            files: ['**/*.ts', '**/*.tsx'],
            parser: '@typescript-eslint/parser',
            plugins: ['@typescript-eslint'],
            extends: ['plugin:@typescript-eslint/recommended'],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
                'no-constant-condition': 'off',
                'no-undef': 'off',
                'no-unused-vars': 'off',
            },
        },
    ],
}

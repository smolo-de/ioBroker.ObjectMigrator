// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.dev-server/',
            '.vscode/',
            '*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/words.js',
            'admin/admin.d.ts',
            'admin/blockly.js',
            '**/adapter-config.d.ts',
            'widgets/**/*.js',
            'admin/build'
        ],
    },
    {
        // you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
        // as this improves maintainability. jsdoc warnings will not block build process.
        rules: {
            // same as @iobroker/eslint-config, but `--fix` must not insert empty JSDoc blocks
            // (they are errors of jsdoc/no-blank-blocks afterwards)
            'jsdoc/require-jsdoc': [
                'warn',
                {
                    publicOnly: true,
                    enableFixer: false,
                    require: { ClassDeclaration: true, MethodDefinition: true, FunctionDeclaration: true },
                    contexts: ['TSInterfaceDeclaration', 'TSMethodSignature', 'TSPropertySignature'],
                },
            ],
        },
    },
    {
        // React components of the admin tab: the props are described by TypeScript interfaces,
        // JSDoc for every component and prop would only repeat them
        files: ['src-admin/**/*.tsx'],
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
        },
    },
];
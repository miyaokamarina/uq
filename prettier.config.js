module.exports = {
    printWidth: 160,
    tabWidth: 4,
    useTabs: false,
    semi: true,
    singleQuote: true,
    quoteProps: 'consistent',
    jsxSingleQuote: true,
    trailingComma: 'all',
    bracketSpacing: true,
    jsxBracketSameLine: false,
    arrowParens: 'avoid',
    proseWrap: 'never',
    htmlWhitespaceSensitivity: 'ignore',
    vueIndentScriptAndStyle: true,
    endOfLine: 'lf',
    embeddedLanguageFormatting: 'auto',

    overrides: [
        {
            files: ['*.md'],
            options: {
                printWidth: 80,
                proseWrap: 'always',
            },
        },
    ],
};

module.exports = {
    sourceMaps: true,
    presets: [
        [
            '@babel/env',
            {
                targets: [
                    '> 2%',
                    'not dead',
                    'not ie <= 11'
                ],
                useBuiltIns: 'usage',
                corejs: 3,
                shippedProposals: true,
            },
        ],
    ],
};

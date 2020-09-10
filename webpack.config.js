const { resolve } = require('upath');

const HtmlPlugin = require('html-webpack-plugin');

const dev = process.env.NODE_ENV === 'development';

module.exports = {
    mode: dev ? 'development' : 'production',
    devtool: 'source-map',
    entry: './src/demo/index.tsx',
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
            '~': resolve(__dirname, 'src'),
        },
    },
    module: {
        rules: [
            {
                test: /\.[jt]sx?$/iu,
                use: 'source-map-loader',
                enforce: 'pre',
            },
            {
                test: /\.tsx?$/iu,
                exclude: /node_modules/u,
                use: ['babel-loader', 'ts-loader'],
            },
        ],
    },
    plugins: [
        new HtmlPlugin({
            template: './src/demo/index.html',
        }),
    ],
    devServer: {
        compress: true,
        contentBase: resolve(__dirname, 'dist'),
        port: 12309,
    },
};

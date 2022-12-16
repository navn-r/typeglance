const path = require('path');
const webpack = require('webpack');

module.exports = {
  target: 'node',
  node: {
    global: false,
    __filename: false,
    __dirname: false,
  },
  optimization: {
    mangleExports: true,
  },
  entry: {
    'language-server-plugin': './src/language-server-plugin.ts',
    launcher: './src/launcher.ts',
  },
  output: {
    path: path.join(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  devtool: 'source-map',
  externals: {
    // vscode will provide its own runtime
    vscode: 'commonjs vscode',
    typescript: 'commonjs typescript',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-typescript'],
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new webpack.IgnorePlugin({
      checkResource(resource) {
        return (
          resource.name === 'bufferutil' || resource.name === 'utf-8-validate'
        );
      },
    }),
  ],
};

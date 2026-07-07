const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Dotenv = require('dotenv-webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

const isAnalyze = String(process.env.ANALYZE || '').toLowerCase() === 'true';

// Dev builds load a project-local `.env` file (if present) on top of the
// shell environment. `safe: true` makes dotenv-webpack error out if the
// .env.example / .env diverges, which is useful when onboarding.
const dotenvOptions = {
  path: path.resolve(__dirname, '.env'),
  safe: false,
  systemvars: true,
  silent: true,
  defaults: false,
  ignoreStub: true,
};

module.exports = {
  mode: 'development',
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    chunkFilename: '[name].[contenthash].js',
    clean: false,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            // The main tsconfig.json enables
            // `allowImportingTsExtensions` + `noEmit: true` so service
            // files can import env.ts with the .ts extension that
            // Node's experimental TS support requires. Webpack still
            // has to emit JS, so we point ts-loader at
            // tsconfig.build.json (which flips noEmit off and disables
            // allowImportingTsExtensions) and run in transpileOnly
            // mode. The top-level `npm run typecheck` step is what
            // actually validates the full type graph.
            transpileOnly: true,
            configFile: path.resolve(__dirname, 'tsconfig.build.json'),
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new Dotenv(dotenvOptions),
    new HtmlWebpackPlugin({
      template: './templates/app.html',
    }),
    // Mirror the production CopyWebpackPlugin behaviour. The dev
    // server already serves `public/` via `static.directory`, but a
    // production-style build (e.g. `webpack --mode production --config
    // webpack.config.dev.js` or `npm run preflight:demo -- --live`)
    // needs the model assets on disk in dist/. Same rationale as the
    // comment in webpack.config.js — see scripts/check-build-assets.js.
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'public/models'),
          to: path.resolve(__dirname, 'dist/models'),
          noErrorOnMissing: true,
        },
      ],
    }),
    new webpack.DefinePlugin({
      'process.env.CLINIC_API_BASE_URL': JSON.stringify(process.env.CLINIC_API_BASE_URL),
      'process.env.TRAINING_API_BASE_URL': JSON.stringify(process.env.TRAINING_API_BASE_URL),
      'process.env.ASSISTANT_API_BASE_URL': JSON.stringify(process.env.ASSISTANT_API_BASE_URL),
      'process.env.NODE_ENV': JSON.stringify('development'),
    }),
    ...(isAnalyze
      ? [
          new BundleAnalyzerPlugin({
            analyzerMode: 'static',
            reportFilename: path.resolve(__dirname, 'dist/bundle-report.html'),
            openAnalyzer: false,
            generateStatsFile: true,
            statsFilename: path.resolve(__dirname, 'dist/bundle-stats.json'),
          }),
        ]
      : []),
  ],
  devServer: {
    port: 3000,
    hot: true,
    static: {
      directory: path.join(__dirname, 'public'),
    },
  },
  optimization: {
    runtimeChunk: 'single',
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        tensorflow: {
          test: /[\\/]node_modules[\\/]@tensorflow[\\/]/,
          name: 'tensorflow',
          chunks: 'all',
          priority: 30,
        },
        firebase: {
          test: /[\\/]node_modules[\\/]firebase[\\/]/,
          name: 'firebase',
          chunks: 'all',
          priority: 25,
        },
        antd: {
          test: /[\\/]node_modules[\\/](antd|@ant-design)[\\/]/,
          name: 'antd',
          chunks: 'all',
          priority: 20,
        },
        echarts: {
          test: /[\\/]node_modules[\\/](echarts|zrender|echarts-for-react)[\\/]/,
          name: 'echarts',
          chunks: 'all',
          priority: 15,
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },
  // D-4 fix-batch-2: also apply the budget to async chunks via
  // performance.assetFilter so dev warns about vendor splits growing
  // past `maxAssetSize`. Source-map files are excluded so the dev
  // server output is not littered with .map size warnings.
  performance: {
    hints: 'warning',
    maxEntrypointSize: 1500000,
    maxAssetSize: 1500000,
    assetFilter: (assetName) => !assetName.endsWith('.map'),
  },
};

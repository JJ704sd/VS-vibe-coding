const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Dotenv = require('dotenv-webpack');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');

const isAnalyze = String(process.env.ANALYZE || '').toLowerCase() === 'true';

// Production builds read from the shell environment (CI, Docker, etc.).
// dotenv-webpack with `path: false` + `systemvars: true` exposes the
// existing process.env to webpack.DefinePlugin via JSON.stringify.
const dotenvOptions = {
  path: false, // do not look for a .env file in prod
  safe: false,
  systemvars: true,
  silent: true,
  defaults: false,
  ignoreStub: true,
};

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    chunkFilename: '[name].[contenthash].js',
    clean: false,
    publicPath: './',
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
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new Dotenv(dotenvOptions),
    new HtmlWebpackPlugin({
      template: './templates/app.html',
      inject: true,
    }),
    new webpack.DefinePlugin({
      // Stringify at build time so the bundle contains the literal URL.
      // When a variable is unset, the value is `undefined`; src/config/env.ts
      // falls back to a localhost default so the dev experience still works.
      'process.env.CLINIC_API_BASE_URL': JSON.stringify(process.env.CLINIC_API_BASE_URL),
      'process.env.TRAINING_API_BASE_URL': JSON.stringify(process.env.TRAINING_API_BASE_URL),
      'process.env.ASSISTANT_API_BASE_URL': JSON.stringify(process.env.ASSISTANT_API_BASE_URL),
      'process.env.NODE_ENV': JSON.stringify('production'),
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
          // Async-only: the Firebase SDK is gated behind an
          // `await import('firebase/...')` inside `firebaseService.initialize()`,
          // so it should not be in the main entrypoint. The `vendor`
          // cacheGroup below `exclude`s this path so the catch-all does
          // not pull firebase back into the main vendor chunk.
          chunks: 'async',
          priority: 25,
        },
        '@firebase': {
          // The `@firebase/*` scoped sub-packages (auth, firestore,
          // storage, util, component, logger, ...) are pulled in
          // transitively by `firebase/app`. They must be split out of
          // the main entrypoint together with `firebase` itself,
          // otherwise the catch-all `vendor` cacheGroup keeps ~1 MiB
          // worth of @firebase modules in the main entry vendor chunk
          // (the previous failure mode). Async-only, same reasoning as
          // the firebase rule.
          test: /[\\/]node_modules[\\/]@firebase[\\/]/,
          name: '@firebase',
          chunks: 'async',
          priority: 24,
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
          // Match anything under node_modules EXCEPT firebase and
          // @tensorflow, which have their own cacheGroups above. We
          // use a function here because webpack 5 cacheGroup does not
          // support an `exclude` field. Without this, the catch-all
          // vendor chunk would pull firebase back into the main
          // entrypoint whenever webpack decides the firebase async-only
          // rule cannot apply.
          test: (module) => {
            if (!module.resource) return false;
            if (!/[\\/]node_modules[\\/]/.test(module.resource)) return false;
            return !/[\\/](firebase|@tensorflow|@firebase)[\\/]/.test(module.resource);
          },
          name: 'vendors',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },
  // Performance budget. We hard-fail CI on over-budget builds (`hints:
  // 'error'`) instead of just warning, so a regression that adds another
  // 200 KiB to the main entrypoint surfaces immediately rather than as a
  // silent yellow icon.
  //
  // The numbers are intentionally generous:
  //   * main entrypoint       1 600 000 B  (1.5 MiB + ~50 KiB headroom)
  //       The main entry is now 1.5 MiB in practice (main bundle + Antd +
  //       a small vendors chunk for react / d3 / fabric / dexie / etc.,
  //       ~28 + 600 + 907 + 4 KiB), but the exact byte count drifts as
  //       dependencies change. The 50 KiB headroom avoids spurious CI
  //       red on a small bump.
  //       Firebase SDK (~1.1 MiB) and TensorFlow.js are pulled in via
  //       async chunks on demand; the firebase chunk is fired only when
  //       AnnotationStudio mounts, so it does not contribute to the
  //       main entrypoint size here.
  //   * individual asset      1 500 000 B  (1.5 MiB)
  //       any single chunk bigger than this is a sign that the splitChunks
  //       cacheGroups (tensorflow / firebase / @firebase / antd / echarts)
  //       are not doing their job and need another look.
  performance: {
    hints: 'error',
    maxEntrypointSize: 1600000,
    maxAssetSize: 1500000,
  },
};

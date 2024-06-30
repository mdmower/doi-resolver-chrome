/**
 * @license Apache-2.0
 */

import path from 'node:path';
import purgecss from '@fullhuman/postcss-purgecss';
import {Browser, dirRef} from './utils.js';
import {Configuration} from 'webpack';
import {EsbuildPlugin} from 'esbuild-loader';
import HtmlBundlerPlugin from 'html-bundler-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';

/**
 * Generate browser-specific webpack config
 * @param debug Whether to run in debug mode
 * @param browser Target browser
 */
export function getWebpackConfig(debug: boolean, browser: Browser): Configuration {
  const entry: Configuration['entry'] = {
    autolink: path.resolve(dirRef.src, 'autolink.ts'),
    context_match: path.resolve(dirRef.src, 'context_match.ts'),
  };
  if (browser !== 'firefox') {
    entry.sw = path.resolve(dirRef.src, 'sw.ts');
  } else if (browser === 'firefox') {
    entry.background = path.resolve(dirRef.src, 'background.ts');
  }

  const htmlEntry: HtmlBundlerPlugin.PluginOptions['entry'] = {
    bubble: path.resolve(dirRef.src, 'bubble.html'),
    citation: path.resolve(dirRef.src, 'citation.html'),
    notification: path.resolve(dirRef.src, 'notification.html'),
    options: path.resolve(dirRef.src, 'options.html'),
    qr: path.resolve(dirRef.src, 'qr.html'),
  };
  if (browser !== 'firefox') {
    htmlEntry.offscreen = path.resolve(dirRef.src, 'offscreen.html');
  }

  return {
    mode: debug ? 'development' : 'production',
    devtool: debug ? 'inline-source-map' : undefined,
    entry,
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'esbuild-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.s?css$/,
          use: [
            'css-loader',
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [
                    // ESM type definitions are incorrect for default purgecss import
                    (purgecss as unknown as typeof purgecss.default)({
                      contentFunction: (sourceFile) => {
                        const name = path.basename(sourceFile).split('.')[0];
                        const sources = [
                          `src/${name}.html`,
                          `src/${name}.ts`,
                          `src/utils.ts`,
                          `src/css/${name}.scss`,
                        ];
                        if (['citation', 'notification', 'options', 'qr'].includes(name)) {
                          sources.push('node_modules/bootstrap/js/src/modal.js');
                        }
                        if (['options'].includes(name)) {
                          sources.push('node_modules/bootstrap/js/src/tab.js');
                        }
                        return sources;
                      },
                      safelist: [/^modal-/],
                    }),
                  ],
                },
              },
            },
            'sass-loader',
          ],
        },
        {
          test: /\.(png|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: 'img/[name].[hash:8][ext][query]',
          },
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    output: {
      filename: '[name].js',
      chunkFilename: '[name].chunk.js',
      path: path.join(dirRef.dist, browser),
    },
    plugins: [
      new EsbuildPlugin({
        define: {
          G_DOI_BROWSER: JSON.stringify(browser),
        },
      }),
      new CopyPlugin({
        patterns: [
          {
            from: path.join(dirRef.static, 'icons'),
            to: path.join(dirRef.dist, browser, 'icons'),
          },
          {
            from: path.join(dirRef.static, 'img'),
            to: path.join(dirRef.dist, browser, 'img'),
          },
          {
            from: path.join(dirRef.static, '_locales'),
            to: path.join(dirRef.dist, browser, '_locales'),
          },
        ],
      }),
      new HtmlBundlerPlugin({
        entry: htmlEntry,
        minifyOptions: debug
          ? undefined
          : {
              collapseBooleanAttributes: true,
              collapseWhitespace: true,
              conservativeCollapse: true,
              decodeEntities: true,
              removeComments: true,
            },
      }),
    ],
  };
}

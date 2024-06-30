/**
 * @license Apache-2.0
 */

import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import webpack from 'webpack';
import minimist from 'minimist';
import colors from 'colors';
import {getWebpackConfig} from './webpack.js';
import {getManifest} from './manifest.js';
import {Browser, browsers, dirRef} from './utils.js';

const {bold} = colors;

/**
 * Write manifest.json
 * @param debug Whether to run in debug mode
 * @param browser Target browser
 */
async function writeManifest(debug: boolean, browser: Browser): Promise<void> {
  try {
    const manifest = await getManifest(debug, browser);
    const manifestJson = JSON.stringify(manifest, undefined, debug ? 2 : undefined);
    const mainfestPath = path.join(dirRef.dist, browser, 'manifest.json');
    console.log(`${bold.green('[Writing manifest]')} manifest.json`);
    await writeFile(mainfestPath, manifestJson, 'utf-8');
  } catch (ex) {
    console.error(bold.red(`[Build error] Unexpected error in ${writeManifest.name}`));
    if (ex) {
      console.error(ex);
    }
    return Promise.reject();
  }
}

/**
 * Compile source for browser target
 * @param debug Whether to run in debug mode
 * @param browser Target browser
 */
async function runWebpack(debug: boolean, browser: Browser): Promise<void> {
  try {
    const config = getWebpackConfig(debug, browser);
    const compiler = webpack(config);
    await new Promise<void>((resolve, reject) => {
      compiler.run((err, stats) => {
        if (err) {
          console.error(bold.red('[Webpack error] Config failure'));
          if ('details' in err && err.details) {
            console.error(err.details);
          } else {
            console.error(err.stack || err);
          }
          return reject();
        }
        if (!stats) {
          return reject();
        }

        console.log(
          stats.toString({
            chunks: false,
            colors: true,
          })
        );

        return stats.hasErrors() ? reject() : resolve();
      });
    });
  } catch (ex) {
    console.error(bold.red(`[Build error] Compilation error in ${runWebpack.name}`));
    if (ex) {
      console.error(ex);
    }
    return Promise.reject();
  }
}

// Build all the things
(async function () {
  let debug = false;
  const filteredBrowsers: Browser[] = [];

  try {
    // Read flags
    const argv = minimist<{debug: boolean}>(process.argv.slice(2), {
      boolean: ['debug'],
    });

    // Set build mode
    debug = argv.debug;
    if (debug) {
      console.warn(bold.yellow('Debug mode enabled'));
    }

    const cmdlineBrowsers = argv._.filter((s): s is Browser =>
      (browsers as readonly string[]).includes(s)
    );
    filteredBrowsers.push(
      ...browsers.filter((browser) => !cmdlineBrowsers.length || cmdlineBrowsers.includes(browser))
    );

    // Prepare output directories
    for (const browser of filteredBrowsers) {
      await mkdir(path.join(dirRef.dist, browser), {recursive: true});
    }
  } catch (ex) {
    console.error(bold.red('[Build error] Unexpected error preparing for build'));
    if (ex) {
      console.error(ex);
    }
    process.exit(1);
  }

  // Error output is handled within each method, no need to re-output here.
  try {
    for (const browser of filteredBrowsers) {
      console.log(`\n${bold.cyan('Building for ' + browser)}`);
      await writeManifest(debug, browser);
      await runWebpack(debug, browser);

      console.log(`\n${bold.green('[Build successful]')} ${browser}`);
    }
  } catch (ex) {
    process.exit(1);
  }
})();

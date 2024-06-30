/**
 * @license Apache-2.0
 */

import {readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import colors from 'colors';
import {dirRef} from './utils.js';

const {bold} = colors;

(async function () {
  try {
    const items = await readdir(dirRef.dist);
    const rmPromises = items.map((item) => rm(path.join(dirRef.dist, item), {recursive: true}));
    await Promise.all(rmPromises);
    console.log(`${bold.green('[Clean successful]')} ${dirRef.dist}`);
  } catch (ex) {
    console.error(`${bold.red('[Clean error]')} Unexpected error during cleanup\n`, ex);
    process.exit(1);
  }
})();

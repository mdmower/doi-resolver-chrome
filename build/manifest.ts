/**
 * @license Apache-2.0
 */

import path from 'node:path';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import deepmerge from 'deepmerge';
import {version} from '../package.json';
import {Browser, dirRef} from './utils.js';

/**
 * Generate browser-specific manifest
 * @param debug Whether to run in debug mode
 * @param browser Target browser
 */
export async function getManifest(
  debug: boolean,
  browser: Browser
): Promise<chrome.runtime.ManifestV3> {
  let manifest: chrome.runtime.ManifestV3 = {
    action: {
      default_icon: {
        16: 'icons/icon16.png',
        19: 'icons/icon19.png',
        24: 'icons/icon24.png',
        32: 'icons/icon32.png',
        38: 'icons/icon38.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
      default_popup: 'bubble.html',
      default_title: '__MSG_iconHover__',
    },
    default_locale: 'en',
    description: '__MSG_appDesc__',
    icons: {
      16: 'icons/icon16.png',
      19: 'icons/icon19.png',
      24: 'icons/icon24.png',
      32: 'icons/icon32.png',
      38: 'icons/icon38.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    manifest_version: 3,
    name: '__MSG_appName__',
    omnibox: {
      keyword: 'doi',
    },
    permissions: ['contextMenus', 'clipboardWrite', 'storage'],
    version,
  };

  // If local.manifest.json exists and this is a debug build, merge into manifest.
  if (debug) {
    const localManifestPath = path.join(dirRef.root, 'local.manifest.json');
    if (existsSync(localManifestPath)) {
      const localManifestJson = await readFile(localManifestPath, 'utf-8');
      const localManifest = JSON.parse(localManifestJson) as chrome.runtime.ManifestV3;
      if (browser === 'firefox' && 'key' in localManifest) {
        delete localManifest.key;
      }
      manifest = deepmerge(manifest, localManifest);
    }
  }

  if (browser === 'firefox') {
    return deepmerge(manifest, {
      background: {
        scripts: ['background.js'],
      },
      browser_specific_settings: {
        gecko: {
          id: '{7befad41-6117-42d0-a803-4fbae41bde5a}',
          strict_min_version: '115.0',
        },
      },
      // optional_host_permissions is not yet recognized by firefox: https://bugzil.la/1766026
      optional_permissions: ['scripting', 'tabs', 'https://*/*', 'http://*/*'],
      options_ui: {
        page: 'options.html',
        open_in_tab: true,
      },
    });
  }

  return deepmerge(manifest, {
    background: {
      service_worker: 'sw.js',
    },
    options_page: 'options.html',
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    optional_permissions: ['offscreen', 'scripting', 'tabs'],
  });
}

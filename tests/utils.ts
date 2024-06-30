import path from 'node:path';
import {existsSync} from 'node:fs';
import puppeteer, {
  Browser,
  BrowserContext,
  PuppeteerLaunchOptions,
  TargetType,
  WebWorker,
} from 'puppeteer';

export const extensionPath = path.join(__dirname, '../dist/chrome');

export const puppeteerLaunchConfig: PuppeteerLaunchOptions = {
  headless: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
};

interface LaunchBrowserResult {
  browser: Browser;
  context: BrowserContext;
  worker: WebWorker;
}
export async function launchBrowser(): Promise<LaunchBrowserResult> {
  if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('Application must be built before running tests');
  }

  const browser = await puppeteer.launch(puppeteerLaunchConfig);
  const context = browser.defaultBrowserContext();

  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === TargetType.SERVICE_WORKER && target.url().endsWith('sw.js')
  );
  const workerResult = await workerTarget.worker();
  if (!workerResult) {
    throw new Error('Worker not available');
  }
  const worker = workerResult;

  const ready = await waitForWorker(worker);
  if (!ready) {
    throw new Error('Worker not ready');
  }

  return {browser, context, worker};
}

export async function waitForWorker(worker: WebWorker): Promise<boolean> {
  let ready = false;

  for (let i = 0; i < 10; i++) {
    ready = await worker.evaluate(
      () =>
        typeof chrome !== 'undefined' &&
        typeof chrome.action !== 'undefined' &&
        typeof chrome.action.openPopup !== 'undefined'
    );
    if (!ready) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    } else {
      continue;
    }
  }

  return ready;
}

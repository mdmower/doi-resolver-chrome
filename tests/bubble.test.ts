import {Browser, Page, WebWorker} from 'puppeteer';
import {launchBrowser} from './utils.js';
import {DisplayTheme} from '../src/lib/options.js';

describe('Bubble', () => {
  let browser: Browser;
  let worker: WebWorker;
  let page: Page;

  beforeAll(async () => {
    ({browser, worker} = await launchBrowser());
  });

  beforeEach(async () => {
    await worker.evaluate(() => chrome.storage.sync.clear());
    await worker.evaluate(() => chrome.action.openPopup());

    const bubbleTarget = await browser.waitForTarget(
      (target) => target.type() === 'page' && target.url().endsWith('bubble.html')
    );
    page = await bubbleTarget.asPage();
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should use display theme', async () => {
    const htmlThemes: string[] = [DisplayTheme.Dark, DisplayTheme.Light];

    for (const theme of Object.values(DisplayTheme)) {
      await page.evaluate((s) => chrome.storage.local.set(s), {theme});
      await page.reload({waitUntil: 'load'});
      const htmlTheme = await page.$eval('html', (html) => html.dataset.bsTheme);
      expect(
        theme === DisplayTheme.System ? htmlThemes.includes(htmlTheme ?? '') : htmlTheme === theme
      ).toBe(true);
    }
  });
});

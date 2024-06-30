/**
 * @license Apache-2.0
 */

import {HistoryDoi, getDefaultOptions, getOptions, setOptions, StorageOptions} from './lib/options';
import {requestCitationPermissions} from './lib/permissions';
import {filterSelectByText, isRecord, isValidDoi, sortHistoryEntries, trimDoi} from './lib/utils';
import {CiteProcSys} from 'citeproc';
import {isInternalMessage, isSettingsUpdatedMessage, MessageCmd} from './lib/messaging';
import {queueRecordDoi} from './lib/history';
import {logDebug, logError, logInfo} from './lib/logger';
import {applyTheme} from './utils';

interface CitationResources {
  citeProcJson: Record<string, unknown>;
  styleXml: string;
  localeXml: string;
}

interface CslStyles {
  cite_styles: {
    code: string;
    title: string;
    default_locale: string;
  }[];
}

interface CslLocales {
  'primary-dialects': Record<string, string | undefined>;
  'language-names': Record<string, string[] | undefined>;
}

interface ReadableLocale {
  locale: string;
  label: string;
}

document.addEventListener(
  'DOMContentLoaded',
  function () {
    new DoiCitation().init().catch((error) => {
      logError('Init failed', error);
    });
  },
  false
);

class DoiCitation {
  private defaultDoiResolver_: string;
  private cslStyles_?: CslStyles;
  private cslLocales_?: CslLocales;
  private elements_: {
    citeDiv: HTMLDivElement;
    citeForm: HTMLFormElement;
    citeLocaleInput: HTMLSelectElement;
    citeStyleFilter: HTMLInputElement;
    doiHistory: HTMLSelectElement;
    doiInput: HTMLInputElement;
    filterHistory: HTMLInputElement;
    historyModalClose: HTMLButtonElement;
    notifyDiv: HTMLDivElement;
    openHistory: HTMLAnchorElement;
    styleList: HTMLSelectElement;
  };

  constructor() {
    this.defaultDoiResolver_ = getDefaultOptions()['doi_resolver'];

    const elementMissing = (selector: string) => {
      throw new Error(`Required element is missing from the page: ${selector}`);
    };
    this.elements_ = {
      citeDiv:
        document.querySelector<HTMLDivElement>('div#citeDiv') || elementMissing('div#citeDiv'),
      citeForm:
        document.querySelector<HTMLFormElement>('form#citeForm') || elementMissing('form#citeForm'),
      citeLocaleInput:
        document.querySelector<HTMLSelectElement>('select#citeLocaleInput') ||
        elementMissing('select#citeLocaleInput'),
      citeStyleFilter:
        document.querySelector<HTMLInputElement>('input#citeStyleFilter') ||
        elementMissing('input#citeStyleFilter'),
      doiHistory:
        document.querySelector<HTMLSelectElement>('select#doiHistory') ||
        elementMissing('select#doiHistory'),
      doiInput:
        document.querySelector<HTMLInputElement>('input#doiInput') ||
        elementMissing('input#doiInput'),
      filterHistory:
        document.querySelector<HTMLInputElement>('input#filterHistory') ||
        elementMissing('input#filterHistory'),
      historyModalClose:
        document.querySelector<HTMLButtonElement>('button#historyModalClose') ||
        elementMissing('button#historyModalClose'),
      notifyDiv:
        document.querySelector<HTMLDivElement>('div#notifyDiv') || elementMissing('div#notifyDiv'),
      openHistory:
        document.querySelector<HTMLAnchorElement>('a#openHistory') ||
        elementMissing('a#openHistory'),
      styleList:
        document.querySelector<HTMLSelectElement>('select#styleList') ||
        elementMissing('select#styleList'),
    };
  }

  /**
   * Initialize citation page.
   */
  public async init(): Promise<void> {
    await this.importCslData();
    this.initializeDoiInput();
    this.getLocalMessages();
    await applyTheme(window);
    await this.initSelections();
    await this.populateHistory();
    this.startListeners();
  }

  /**
   * Import CSL styles and locales
   */
  private async importCslData(): Promise<void> {
    // TODO: Revert this workaround once https://github.com/webpack/webpack/issues/17042 is resolved.
    // webpack 5.80.0 introduced a bug where dynamically imported JSON doesn't destructure correctly.
    // The issue still exists as of webpack 5.84.1.

    // const {default: cslStyles} = await import('../csl/styles/styles.json');
    const cslStyles = (await import('./csl/styles/styles.json')).default;
    this.cslStyles_ = cslStyles;
    // const {default: cslLocales} = await import('../csl/locales/locales.json');
    const cslLocales = (await import('./csl/locales/locales.json')).default;
    this.cslLocales_ = cslLocales;
  }

  /**
   * Attach window/element listeners.
   */
  private startListeners(): void {
    this.elements_.citeForm.addEventListener('submit', this.formSubmitHandler.bind(this));

    const doiHistory = this.elements_.doiHistory;
    const textInput = this.elements_.filterHistory;
    textInput.addEventListener('input', function () {
      filterSelectByText(doiHistory, this.value, false);
    });

    const doiInput = this.elements_.doiInput;
    const historyModalClose = this.elements_.historyModalClose;
    doiHistory.addEventListener('change', function () {
      doiInput.value = this.value;
      this.selectedIndex = -1;
      historyModalClose.click();
    });

    chrome.runtime.onMessage.addListener(this.runtimeMessageHandler.bind(this));
  }

  /**
   * Get DOI from query paramter and insert into <input> element
   */
  private initializeDoiInput(): void {
    const doi = new URL(location.href).searchParams.get('doi');
    this.elements_.doiInput.value = doi || '';
  }

  /**
   * Initialize CSL style and locale <select> elements and filters
   */
  private async initSelections() {
    const stg = await getOptions('local', ['cite_locale', 'cite_style']);

    let storedLocale = stg.cite_locale || getDefaultOptions()['cite_locale'];
    let storedStyle = stg.cite_style || getDefaultOptions()['cite_style'];

    if (!this.cslStyles_ || !this.cslLocales_) {
      throw new Error('CSL styles and locales data not available');
    }

    const languageNames = this.cslLocales_['language-names'];
    const allLocales = Object.keys(languageNames);
    const allStyles = this.cslStyles_.cite_styles;

    if (!allLocales.includes(storedLocale)) {
      storedLocale = 'auto';
      await setOptions('local', {cite_locale: 'auto'});
    }

    // TODO: Offer option to display locales in their native language.
    // Retrieved with: localesMap[allLocales[i]][0]]
    const readableLocales: ReadableLocale[] = allLocales.map((locale) => {
      const labels = languageNames[locale] || [];
      const label = labels[1] || locale;
      return {locale, label};
    });
    readableLocales.sort((a, b) => {
      if (a.label == b.label) {
        return 0;
      }
      return a.label < b.label ? -1 : 1;
    });

    const generateOption = (
      value: string,
      label: string,
      selected: boolean,
      defaultLocale?: string
    ) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = selected;
      if (defaultLocale) {
        option.dataset.locale = defaultLocale;
      }
      return option;
    };

    const citeLocaleInput = this.elements_.citeLocaleInput;
    const localeOption = generateOption('auto', 'Auto', 'auto' === storedLocale);
    citeLocaleInput.appendChild(localeOption);

    readableLocales.forEach((readableLocale) => {
      const {locale, label} = readableLocale;
      const localeOption = generateOption(locale, label, locale === storedLocale);
      citeLocaleInput.appendChild(localeOption);
    });

    const allStyleCodes = Array.from(allStyles, (item) => item.code);

    // Style not found or "other" (migration)
    if (!allStyleCodes.includes(storedStyle)) {
      storedStyle = getDefaultOptions()['cite_style'];
      await setOptions('local', {cite_style: storedStyle});
    }

    const styleList = this.elements_.styleList;
    allStyles.forEach((style) => {
      const {code, title, default_locale} = style;
      const styleOption = generateOption(code, title, code === storedStyle, default_locale);
      styleList.appendChild(styleOption);
    });

    if (styleList.selectedOptions.length) {
      styleList.selectedOptions[0].scrollIntoView();
    }

    this.elements_.citeStyleFilter.addEventListener('input', function () {
      filterSelectByText(styleList, this.value, true);
    });
  }

  /**
   * Handle runtime messages
   * @param message Internal message
   */
  private runtimeMessageHandler(message: unknown): boolean | void {
    if (!isInternalMessage(message)) {
      return;
    }

    switch (message.cmd) {
      case MessageCmd.SettingsUpdated:
        if (isSettingsUpdatedMessage(message) && message.data) {
          this.handleSettingsUpdate(message.data.options).catch((error) => {
            logError('Failed to handle settings update', error);
          });
        }
        break;
      default:
        break;
    }
  }

  /**
   * Handle settings updated runtime message
   * @param updatedOptions Updated options
   */
  async handleSettingsUpdate(updatedOptions: StorageOptions): Promise<void> {
    // Debugging
    // logInfo('Storage changed, checking for updates');

    if (Object.keys(updatedOptions).length === 0) {
      // Debugging
      // logInfo('Nothing to update');
      return;
    }

    const historyRefreshOptions: (keyof StorageOptions)[] = [
      'cr_history',
      'custom_resolver',
      'doi_resolver',
      'history_sortby',
      'recorded_dois',
      'shortdoi_resolver',
    ];

    const historyUpdated = historyRefreshOptions.some(
      (option) => updatedOptions[option] !== undefined
    );

    if (historyUpdated) {
      logInfo('History updated');
      await this.populateHistory();
    } else {
      // Debugging
      // logInfo('No relevant updates found');
    }
  }

  /**
   * Handle form submission
   * @param event Submit event
   */
  private formSubmitHandler(event: SubmitEvent): void {
    event.preventDefault();

    const doiInput = encodeURI(trimDoi(this.elements_.doiInput.value));
    if (!isValidDoi(doiInput)) {
      this.simpleNotification(chrome.i18n.getMessage('invalidDoiAlert'));
      return;
    }

    const selectedStyle = this.elements_.styleList.value;
    if (!selectedStyle) {
      this.simpleNotification(chrome.i18n.getMessage('citeStyleNotSelected'));
      return;
    }

    let defaultLocaleForStyle = '';
    const selectedStyleOption = this.elements_.styleList.selectedOptions[0];
    if (selectedStyleOption) {
      defaultLocaleForStyle = selectedStyleOption.dataset.locale || '';
    }

    let selectedLocale = this.elements_.citeLocaleInput.value;
    if (!selectedLocale) {
      selectedLocale = 'auto';
    }

    this.formSubmitHandlerAsync(
      doiInput,
      selectedStyle,
      selectedLocale,
      defaultLocaleForStyle
    ).catch((error) => {
      this.simpleNotification(chrome.i18n.getMessage('noCitationFound'));
      logError('Failed to handle form submission', error);
    });
  }

  /**
   * Async handler for form submission
   * @param doi DOI
   * @param style CSL style
   * @param locale CSL locale
   * @param defaultLocaleForStyle Default CSL locale for the CSL style
   */
  private async formSubmitHandlerAsync(
    doi: string,
    style: string,
    locale: string,
    defaultLocaleForStyle: string
  ): Promise<void> {
    // Permissions will be cleaned when last QR/Citation tab is closed
    // Note: Citation permissions are sufficient for history title fetch
    // in the background, so no need to also request meta permissions.
    const granted = await requestCitationPermissions();
    if (!granted) {
      this.simpleNotification(chrome.i18n.getMessage('needCitationPerm'));
      return;
    }

    await queueRecordDoi(doi);
    await setOptions('local', {
      cite_style: style,
      cite_locale: locale,
    });

    let forceLocale = true;
    if (locale === 'auto') {
      // Default to en-US in case a defaultLocale is not defined
      locale = defaultLocaleForStyle || 'en-US';
      forceLocale = false;
    }

    const citationResources = await this.getCitationResources(doi, style, locale);
    if (!citationResources) {
      // Message has already been displayed to end user
      return;
    }

    await this.renderCitation(citationResources, locale, forceLocale);
  }

  /**
   * Clear message and citation spaces
   */
  private resetSpace(): void {
    this.elements_.notifyDiv.innerHTML = '';
    this.elements_.notifyDiv.hidden = true;
    this.elements_.citeDiv.innerHTML = '';
    this.elements_.citeDiv.hidden = true;
  }

  /**
   * Print a notification
   * @param message Message
   */
  private simpleNotification(message: string): void {
    this.resetSpace();
    this.elements_.notifyDiv.innerHTML = message;
    this.elements_.notifyDiv.hidden = false;
  }

  /**
   * Output a formatted citation
   * @param citation Formatted citation
   */
  private outputCitation(citation: string): void {
    this.resetSpace();
    this.elements_.citeDiv.innerHTML = citation;
    this.elements_.citeDiv.hidden = false;
  }

  /**
   * Fetch a formatted citation
   * @param doi DOI
   * @param style CSL style
   * @param locale CSL locale
   */
  private async getCitationResources(
    doi: string,
    style: string,
    locale: string
  ): Promise<CitationResources | undefined> {
    this.simpleNotification(chrome.i18n.getMessage('loading'));

    const citeProcJsonPromise = this.getCiteProcJson(doi);
    const styleXmlPromise = this.getStyleXml(style);
    const localeXmlPromise = this.getLocaleXml(locale);
    const responses = await Promise.all([citeProcJsonPromise, styleXmlPromise, localeXmlPromise]);
    const [citeProcJson, styleXml, localeXml] = responses;

    if (!citeProcJson) {
      logError('Invalid CiteProc JSON');
      this.simpleNotification(chrome.i18n.getMessage('noCitationFound'));
      return;
    }

    if (!styleXml) {
      logError('Invalid style XML');
      this.simpleNotification(
        chrome.i18n.getMessage('citeStyleLoadFailP1') +
          style +
          chrome.i18n.getMessage('citeStyleLoadFailP2')
      );
      return;
    }

    if (!localeXml) {
      logError('Invalid locale XML');
      this.simpleNotification(
        chrome.i18n.getMessage('citeLocaleLoadFailP1') +
          locale +
          chrome.i18n.getMessage('citeLocaleLoadFailP2')
      );
      return;
    }

    return {citeProcJson, styleXml, localeXml};
  }

  /**
   * Download the CiteProc JSON for the DOI
   * @param doi DOI
   */
  private async getCiteProcJson(doi: string): Promise<Record<string, unknown> | null> {
    const headers = new Headers();
    headers.append('Accept', 'application/vnd.citationstyles.csl+json');

    const request = new Request(this.defaultDoiResolver_ + doi, {
      method: 'GET',
      headers: headers,
    });

    let json: Record<string, unknown> | null = null;
    logDebug('Downloading citeproc JSON');
    // console.time('Citeproc JSON download');
    try {
      const response = await fetch(request, {credentials: 'omit'});
      if (!response.ok) {
        throw new Error(`Bad status code: ${response.status}`);
      }
      const unsafeJson: unknown = await response.json();
      if (!isRecord(unsafeJson)) {
        throw new Error('Unable to parse response as JSON');
      }
      json = unsafeJson;
    } catch (ex) {
      logError('Unable to download citation JSON', ex);
    }
    // console.timeEnd('Citeproc JSON download');
    return json;
  }

  /**
   * Download the CSL style XML
   * @param style CSL style
   */
  private async getStyleXml(style: string): Promise<string> {
    let text = '';
    logDebug('Downloading style XML');
    // console.time('Style XML download');
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/citation-style-language/styles/master/${style}.csl`,
        {credentials: 'omit'}
      );
      if (!response.ok) {
        throw new Error(`Bad status code: ${response.status}`);
      }
      text = await response.text();
    } catch (ex) {
      logError('Unable to download style XML', ex);
    }
    // console.timeEnd('Style XML download');
    return text;
  }

  /**
   * Download the CSL locale XML
   * @param locale CSL locale
   */
  private async getLocaleXml(locale: string): Promise<string> {
    let text = '';
    logDebug('Downloading locale XML');
    // console.time('Locale XML download');
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${locale}.xml`,
        {credentials: 'omit'}
      );
      if (!response.ok) {
        throw new Error(`Bad status code: ${response.status}`);
      }
      text = await response.text();
    } catch (ex) {
      logError('Unable to download locale XML', ex);
    }
    // console.timeEnd('Locale XML download');
    return text;
  }

  /**
   * Render the citation
   * @param citationResources Downloaded resources to generate citation
   * @param locale CSL locale
   * @param forceLocale Whether to use the provided locale or
   * to determine the appropriate locale automatically
   */
  private async renderCitation(
    citationResources: CitationResources,
    locale: string,
    forceLocale: boolean
  ): Promise<void> {
    const {default: CSL} = await import('citeproc');
    const {citeProcJson, styleXml, localeXml} = citationResources;

    citeProcJson.id = 'Item-1';
    const citations: Record<string, unknown> = {'Item-1': citeProcJson};

    const citeprocSys: CiteProcSys = {
      retrieveLocale: function () {
        return localeXml;
      },
      retrieveItem: function (id: string) {
        return citations[id];
      },
    };

    const citeproc = forceLocale
      ? new CSL.Engine(citeprocSys, styleXml, locale, forceLocale)
      : new CSL.Engine(citeprocSys, styleXml);

    citeproc.updateItems(Object.keys(citations));

    const bibResult = citeproc.makeBibliography();
    if (bibResult) {
      this.outputCitation(bibResult[1].join('\n'));
    } else {
      this.simpleNotification(chrome.i18n.getMessage('citeStyleGenFail'));
    }
  }

  /**
   * Read history entries from storage and populate the <select> box.
   */
  private async populateHistory(): Promise<void> {
    const stg = await getOptions('local', [
      'history',
      'recorded_dois',
      'history_showsave',
      'history_showtitles',
      'history_sortby',
    ]);

    const showHideTarget = this.elements_.openHistory.parentElement ?? this.elements_.openHistory;
    if (!stg.history || !stg.recorded_dois || !stg.recorded_dois.length) {
      showHideTarget.hidden = true;
      return;
    }
    showHideTarget.hidden = false;

    // Skip holes in the array (should not occur)
    stg.recorded_dois = stg.recorded_dois.filter(Boolean);

    sortHistoryEntries(stg.recorded_dois, stg.history_sortby);

    const createOption = (item: HistoryDoi): HTMLOptionElement => {
      const {doi, title, save} = item;
      const element = document.createElement('option');
      element.value = doi;
      element.textContent = stg.history_showtitles && title ? title : doi;
      element.title = [doi, title].join(' - ');
      if (save) {
        element.classList.add('save');
      }
      return element;
    };

    const optionElements: HTMLOptionElement[] = [];
    const savedOptions = stg.recorded_dois.filter((item) => item.save).map(createOption);
    const unsavedOptions = !stg.history_showsave
      ? stg.recorded_dois.filter((item) => !item.save).map(createOption)
      : [];
    const dividerOptions: HTMLOptionElement[] = [];
    if (savedOptions.length && unsavedOptions.length) {
      const dividerOption = document.createElement('option');
      dividerOption.disabled = true;
      dividerOption.textContent = chrome.i18n.getMessage('historySaveDivider');
      dividerOptions.push(dividerOption);
    }
    optionElements.push(...savedOptions, ...dividerOptions, ...unsavedOptions);

    const selectBox = this.elements_.doiHistory;
    selectBox.selectedIndex = -1;
    while (selectBox.firstChild) {
      selectBox.removeChild(selectBox.firstChild);
    }
    optionElements.forEach((optionElement) => selectBox.appendChild(optionElement));
  }

  /**
   * Get localization strings and populate their corresponding elements' HTML.
   */
  private getLocalMessages(): void {
    const message = chrome.i18n.getMessage('citeHeading');
    document.title = message;

    const messageIds = [
      'citeHeading',
      'citeLocaleLabel',
      'citeStyleFilterLabel',
      'citeSubHeading',
      'doiInputLabel',
      'submitButton',
    ];

    messageIds.forEach((messageId) => {
      const message = chrome.i18n.getMessage(messageId);
      const element = document.getElementById(messageId);
      if (element) {
        element.innerHTML = message;
      } else {
        logInfo(`Message for #${messageId} not inserted because element not found.`);
      }
    });

    const openHistory = document.getElementById('openHistory');
    if (openHistory) {
      openHistory.title = chrome.i18n.getMessage('headingHistory');
    }

    const filterHistory = document.querySelector<HTMLInputElement>('input#filterHistory');
    if (filterHistory) {
      filterHistory.placeholder = chrome.i18n.getMessage('filterHistoryLabel');
    }

    const modalLabel = document.getElementById('modalLabel');
    if (modalLabel) {
      modalLabel.innerHTML = chrome.i18n.getMessage('headingHistory');
    }
  }
}

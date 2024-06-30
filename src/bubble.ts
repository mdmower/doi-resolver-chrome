/**
 * @license Apache-2.0
 */

import {
  CustomResolverSelection,
  HistoryDoi,
  StorageOptions,
  getOptions,
  isCustomResolverSelection,
  setOptions,
} from './lib/options';
import {requestMetaPermissions} from './lib/permissions';
import {filterSelectByText, isValidDoi, sortHistoryEntries, trimDoi} from './lib/utils';
import {queueRecordDoi} from './lib/history';
import {resolveDoi} from './lib/resolve';
import {logError, logInfo} from './lib/logger';
import {applyTheme} from './utils';

document.addEventListener(
  'DOMContentLoaded',
  function () {
    new DoiBubble().init().catch((error) => {
      logError('Init failed', error);
    });
  },
  false
);

enum BubbleAction {
  Qr = 'qr',
  Cite = 'cite',
  Doi = 'doi',
  Options = 'options',
}

/**
 * Verify an item is an instance of BubbleAction
 * @param val Unverified item
 */
function isBubbleAction(val: unknown): val is BubbleAction {
  return typeof val === 'string' && Object.values<string>(BubbleAction).includes(val);
}

class DoiBubble {
  private needsHistoryMetaPermissions_: boolean;

  private elements_: {
    citeSubmit: HTMLButtonElement;
    crRadioBubbleCustom: HTMLInputElement;
    crRadioBubbleDefault: HTMLInputElement;
    crRadios: HTMLDivElement;
    doiForm: HTMLFormElement;
    doiHistory: HTMLSelectElement;
    hiddenButtonInput: HTMLInputElement;
    historyDiv: HTMLDivElement;
    messageDiv: HTMLDivElement;
    messageOutput: HTMLDivElement;
    metaButtons: HTMLDivElement;
    optionsSubmit: HTMLButtonElement;
    qrSubmit: HTMLButtonElement;
    resolveSubmit: HTMLButtonElement;
    textInput: HTMLInputElement;
  };

  constructor() {
    this.needsHistoryMetaPermissions_ = false;

    const elementMissing = (selector: string) => {
      throw new Error(`Required element is missing from the page: ${selector}`);
    };
    this.elements_ = {
      citeSubmit:
        document.querySelector<HTMLButtonElement>('button#citeSubmit') ||
        elementMissing('button#citeSubmit'),
      crRadioBubbleCustom:
        document.querySelector<HTMLInputElement>('input#crRadioBubbleCustom[name="crRadio"]') ||
        elementMissing('input#crRadioBubbleCustom[name="crRadio"]'),
      crRadioBubbleDefault:
        document.querySelector<HTMLInputElement>('input#crRadioBubbleDefault[name="crRadio"]') ||
        elementMissing('input#crRadioBubbleDefault[name="crRadio"]'),
      crRadios:
        document.querySelector<HTMLDivElement>('div#crRadios') || elementMissing('div#crRadios'),
      doiForm:
        document.querySelector<HTMLFormElement>('form#doiForm') || elementMissing('form#doiForm'),
      doiHistory:
        document.querySelector<HTMLSelectElement>('select#doiHistory') ||
        elementMissing('select#doiHistory'),
      hiddenButtonInput:
        document.querySelector<HTMLInputElement>('input#hiddenButtonInput') ||
        elementMissing('input#hiddenButtonInput'),
      historyDiv:
        document.querySelector<HTMLDivElement>('div#historyDiv') ||
        elementMissing('div#historyDiv'),
      messageDiv:
        document.querySelector<HTMLDivElement>('div#messageDiv') ||
        elementMissing('div#messageDiv'),
      messageOutput:
        document.querySelector<HTMLDivElement>('div#messageOutput') ||
        elementMissing('div#messageOutput'),
      metaButtons:
        document.querySelector<HTMLDivElement>('div#metaButtons') ||
        elementMissing('div#metaButtons'),
      optionsSubmit:
        document.querySelector<HTMLButtonElement>('button#optionsSubmit') ||
        elementMissing('button#optionsSubmit'),
      qrSubmit:
        document.querySelector<HTMLButtonElement>('button#qrSubmit') ||
        elementMissing('button#qrSubmit'),
      resolveSubmit:
        document.querySelector<HTMLButtonElement>('button#resolveSubmit') ||
        elementMissing('button#resolveSubmit'),
      textInput:
        document.querySelector<HTMLInputElement>('input#textInput') ||
        elementMissing('input#textInput'),
    };
  }

  /**
   * Initialize bubble.
   */
  public async init() {
    await this.restoreOptions();
    this.getLocalMessages();
    await applyTheme(window);
    await this.showHideOptionalElms();
    await this.setHistoryMetaPermissions();
    await this.populateHistory();
    this.startListeners();
  }

  /**
   * Attach window/element listeners.
   */
  private startListeners(): void {
    const elements = this.elements_;
    elements.resolveSubmit.addEventListener('click', function () {
      elements.hiddenButtonInput.value = BubbleAction.Doi;
    });
    elements.citeSubmit.addEventListener('click', function () {
      elements.hiddenButtonInput.value = BubbleAction.Cite;
    });
    elements.qrSubmit.addEventListener('click', function () {
      elements.hiddenButtonInput.value = BubbleAction.Qr;
    });
    elements.optionsSubmit.addEventListener('click', function () {
      elements.hiddenButtonInput.value = BubbleAction.Options;
    });

    const formSubmitHandler = this.formSubmitHandler.bind(this);
    elements.doiForm.addEventListener('submit', function (event) {
      event.preventDefault();
      formSubmitHandler();
    });

    const saveOptions = this.saveOptions.bind(this);
    elements.crRadioBubbleCustom.addEventListener('click', saveOptions);
    elements.crRadioBubbleDefault.addEventListener('click', saveOptions);
  }

  /**
   * Save options to storage
   */
  private saveOptions(): void {
    const options: StorageOptions = {};

    const checkedCrRadio = document.querySelector<HTMLInputElement>(
      'input[name="crRadio"]:checked'
    );
    if (checkedCrRadio) {
      if (isCustomResolverSelection(checkedCrRadio.value)) {
        options.cr_bubble_last = checkedCrRadio.value;
      }
    }

    if (Object.keys(options).length) {
      setOptions('local', options).catch((error) => {
        logError('Unable to save options', error);
      });
    }
  }

  /**
   * Restore options from storage
   */
  private async restoreOptions(): Promise<void> {
    const stg = await getOptions('local', ['cr_bubble_last']);
    if (stg.cr_bubble_last === 'custom') {
      this.elements_.crRadioBubbleCustom.checked = true;
    } else {
      this.elements_.crRadioBubbleDefault.checked = true;
    }
  }

  /**
   * Clear message space
   */
  private resetMessageSpace(): void {
    this.elements_.messageOutput.innerHTML = '';
    this.elements_.messageDiv.hidden = true;
  }

  /**
   * Print a notification
   * @param message Message
   */
  private bubbleMessage(message: string): void {
    this.resetMessageSpace();
    this.elements_.messageOutput.innerHTML = message;
    this.elements_.messageDiv.hidden = false;
  }

  /**
   * Handle form submission
   */
  private formSubmitHandler(): void {
    const action = this.elements_.hiddenButtonInput.value;
    if (!isBubbleAction(action)) {
      logError('Unrecognized action');
      return;
    }
    const doiInput = encodeURI(trimDoi(this.elements_.textInput.value));
    this.formSubmitHandlerAsync(action, doiInput).catch((error) => {
      logError('Failed to submit form', error);
    });
  }

  /**
   * Async handler for form submissions
   * @param action Form action type
   * @param doiInput User-entered DOI
   */
  private async formSubmitHandlerAsync(action: BubbleAction, doiInput: string): Promise<void> {
    switch (action) {
      case BubbleAction.Qr:
        if (isValidDoi(doiInput)) {
          if (this.needsHistoryMetaPermissions_) {
            await requestMetaPermissions();
          }
          await queueRecordDoi(doiInput);
        }
        // Allow tab to open with invalid DOI
        this.openQrGenerator(doiInput);
        break;
      case BubbleAction.Cite:
        if (isValidDoi(doiInput)) {
          if (this.needsHistoryMetaPermissions_) {
            await requestMetaPermissions();
          }
          await queueRecordDoi(doiInput);
        }
        // Allow tab to open with invalid DOI
        this.openCitationGenerator(doiInput);
        break;
      case BubbleAction.Doi:
        if (isValidDoi(doiInput)) {
          if (this.needsHistoryMetaPermissions_) {
            await requestMetaPermissions();
          }
          await queueRecordDoi(doiInput);
          await this.resolveDoi(doiInput);
        } else {
          this.bubbleMessage(chrome.i18n.getMessage('invalidDoiAlert'));
        }
        break;
      case BubbleAction.Options:
        chrome.runtime.openOptionsPage(() => {
          window.close();
        });
        break;
      default:
        break;
    }
  }

  /**
   * Resolve a DOI in a new foreground tab.
   * @param doi DOI
   */
  private async resolveDoi(doi: string): Promise<void> {
    const stg = await getOptions('local', [
      'custom_resolver',
      'cr_bubble',
      'cr_bubble_last',
      'doi_resolver',
      'shortdoi_resolver',
    ]);

    const useCustomResolver = !!(
      stg.custom_resolver &&
      (stg.cr_bubble === 'custom' ||
        (stg.cr_bubble === 'selectable' && stg.cr_bubble_last === 'custom'))
    );

    await resolveDoi(doi, useCustomResolver, 'newForegroundTab');
    window.close();
  }

  /**
   * Open Citation Generator page
   * @param doi DOI-like string
   */
  private openCitationGenerator(doi: string): void {
    const url = 'citation.html?doi=' + encodeURIComponent(doi);
    chrome.tabs.create({url}, () => {
      window.close();
    });
  }

  /**
   * Open QR Generator page
   * @param doi DOI-like string
   */
  private openQrGenerator(doi: string): void {
    const url = 'qr.html?doi=' + encodeURIComponent(doi);
    chrome.tabs.create({url}, () => {
      window.close();
    });
  }

  /**
   * Show or hide additional buttons in bubble
   */
  async showHideOptionalElms(): Promise<void> {
    const stg = await getOptions('local', ['meta_buttons', 'custom_resolver', 'cr_bubble']);

    this.elements_.metaButtons.hidden = !stg.meta_buttons;
    this.elements_.crRadios.hidden =
      !stg.custom_resolver || stg.cr_bubble !== CustomResolverSelection.Selectable;
  }

  /**
   * Get the size of the <select> box for history DOIs
   * @param numEntries Number of history entries
   */
  private getSelectBoxSize(numEntries: number): number {
    if (numEntries > 6) {
      return 6;
    }
    if (numEntries < 2) {
      return 2;
    }
    return numEntries;
  }

  /**
   * Determine whether to request meta permissions if history is enabled with
   * automatic title retrieval.
   */
  private async setHistoryMetaPermissions(): Promise<void> {
    const stg = await getOptions('local', ['history', 'history_fetch_title']);
    this.needsHistoryMetaPermissions_ = !!(stg.history && stg.history_fetch_title);
  }

  /**
   * Read history entries from storage and populate the <select> box.
   */
  async populateHistory(): Promise<void> {
    const stg = await getOptions('local', [
      'meta_buttons',
      'history',
      'recorded_dois',
      'history_showsave',
      'history_showtitles',
      'history_sortby',
    ]);

    if (!stg.meta_buttons || !stg.history) {
      this.elements_.historyDiv.hidden = true;
      return;
    }
    if (!stg.recorded_dois || stg.recorded_dois.length < 1) {
      this.elements_.historyDiv.hidden = true;
      return;
    }

    this.elements_.historyDiv.hidden = false;

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
      dividerOptions.push(dividerOption);
    }
    optionElements.push(...savedOptions, ...dividerOptions, ...unsavedOptions);

    const selectBox = this.elements_.doiHistory;
    selectBox.size = this.getSelectBoxSize(optionElements.length);
    selectBox.selectedIndex = -1;
    optionElements.forEach((optionElement) => selectBox.appendChild(optionElement));

    const filterInput = function (this: HTMLInputElement): void {
      filterSelectByText(selectBox, this.value, false);
    };

    const textInput = this.elements_.textInput;
    const resetMessageSpace = this.resetMessageSpace.bind(this);
    textInput.addEventListener('input', filterInput);
    selectBox.addEventListener('change', function () {
      textInput.removeEventListener('input', filterInput);
      textInput.value = this.value;
      textInput.addEventListener('input', filterInput);
      this.selectedIndex = -1;
      resetMessageSpace();
    });
  }

  /**
   * Get localization strings and populate their corresponding elements' HTML.
   */
  getLocalMessages(): void {
    const nestedMessageIds = ['citeSubmit', 'optionsSubmit', 'qrSubmit'];

    nestedMessageIds.forEach((messageId) => {
      const message = chrome.i18n.getMessage(messageId);
      const element = document.getElementById(messageId + 'Text');
      if (element) {
        element.innerHTML = message;
      }
    });

    const messageIds = [
      'optionCrCustom',
      'optionCrDefault',
      'optionCrLabelBubble',
      'resolveSubmit',
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
  }
}

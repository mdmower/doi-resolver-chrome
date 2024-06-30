/**
 * @license Apache-2.0
 */

import {
  HistoryDoi,
  QrImageType,
  StorageOptions,
  getDefaultOptions,
  isQrImageType,
  getOptions,
  setOptions,
} from './lib/options';
import {requestMetaPermissions} from './lib/permissions';
import {
  debounce,
  filterSelectByText,
  isHexColor,
  isValidDoi,
  sortHistoryEntries,
  trimDoi,
} from './lib/utils';
import iro from '@jaames/iro';
import {ColorPickerProps, IroColorPicker} from '@jaames/iro/dist/ColorPicker';
import {isInternalMessage, isSettingsUpdatedMessage, MessageCmd} from './lib/messaging';
import {getSavedDoiTitle, recordDoi, queueRecordDoi} from './lib/history';
import {fetchDoiTitle} from './lib/metadata';
import {logError, logInfo} from './lib/logger';
import {applyTheme} from './utils';

interface CreateQrParams {
  size: number;
  border: number;
  fgColor: string;
  bgColor: string | null;
  imgType: QrImageType;
  text: string;
}

enum TitleRetrievalStatus {
  Found,
  Missing,
  Disabled,
}

document.addEventListener(
  'DOMContentLoaded',
  function () {
    new DoiQr().init().catch((error) => {
      logError('Init failed', error);
    });
  },
  false
);

class DoiQr {
  private defaultDoiResolver_: string;
  private needsHistoryMetaPermissions_: boolean;
  private savedBgInputColorStyle_?: string;
  private fgColorPicker_?: IroColorPicker;
  private bgColorPicker_?: IroColorPicker;

  private saveOptionsDebounced_: () => void;
  private saveQrDimensionsDebounced_: () => void;
  private qrFetchTitleChangeHandler_?: (event: Event) => void;
  private qrManualMessageChangeHandler_?: (event: Event) => void;
  private iroFgColorChangeHandler_?: (color: iro.Color) => void;
  private iroBgColorChangeHandler_?: (color: iro.Color) => void;

  private elements_: {
    doiForm: HTMLFormElement;
    doiHistory: HTMLSelectElement;
    doiInput: HTMLInputElement;
    filterHistory: HTMLInputElement;
    historyModalClose: HTMLButtonElement;
    mainForm: HTMLDivElement;
    notify_template: HTMLTemplateElement;
    notifyDiv: HTMLDivElement;
    openHistory: HTMLAnchorElement;
    qrBgColorInput: HTMLInputElement;
    qrBgColorPicker: HTMLDivElement;
    qrBgTrans: HTMLInputElement;
    qrBorderInput: HTMLInputElement;
    qrDiv: HTMLDivElement;
    qrFetchTitle: HTMLInputElement;
    qrFgColorInput: HTMLInputElement;
    qrImageTypePng: HTMLInputElement;
    qrImageTypeSvg: HTMLInputElement;
    qrManualMessage: HTMLInputElement;
    qrManualMessageText: HTMLInputElement;
    qrManualMessageTextDiv: HTMLDivElement;
    qrSizeInput: HTMLInputElement;
    submitButton: HTMLButtonElement;
  };

  constructor() {
    this.defaultDoiResolver_ = getDefaultOptions()['doi_resolver'];
    this.needsHistoryMetaPermissions_ = false;
    this.saveOptionsDebounced_ = debounce(this.saveOptions.bind(this), 500);
    this.saveQrDimensionsDebounced_ = debounce(this.saveQrDimensions.bind(this), 500);

    const elementMissing = (selector: string) => {
      throw new Error(`Required element is missing from the page: ${selector}`);
    };
    this.elements_ = {
      doiForm:
        document.querySelector<HTMLFormElement>('form#doiForm') || elementMissing('form#doiForm'),
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
      mainForm:
        document.querySelector<HTMLDivElement>('div#mainForm') || elementMissing('div#mainForm'),
      notify_template:
        document.querySelector<HTMLTemplateElement>('template#notifyTemplate') ||
        elementMissing('template#notifyTemplate'),
      notifyDiv:
        document.querySelector<HTMLDivElement>('div#notifyDiv') || elementMissing('div#notifyDiv'),
      openHistory:
        document.querySelector<HTMLAnchorElement>('a#openHistory') ||
        elementMissing('a#openHistory'),
      qrBgColorInput:
        document.querySelector<HTMLInputElement>('input#qrBgColorInput') ||
        elementMissing('input#qrBgColorInput'),
      qrBgColorPicker:
        document.querySelector<HTMLDivElement>('div#qrBgColorPicker') ||
        elementMissing('div#qrBgColorPicker'),
      qrBgTrans:
        document.querySelector<HTMLInputElement>('input#qrBgTrans') ||
        elementMissing('input#qrBgTrans'),
      qrBorderInput:
        document.querySelector<HTMLInputElement>('input#qrBorderInput') ||
        elementMissing('input#qrBorderInput'),
      qrDiv: document.querySelector<HTMLDivElement>('div#qrDiv') || elementMissing('div#qrDiv'),
      qrFetchTitle:
        document.querySelector<HTMLInputElement>('input#qrFetchTitle') ||
        elementMissing('input#qrFetchTitle'),
      qrFgColorInput:
        document.querySelector<HTMLInputElement>('input#qrFgColorInput') ||
        elementMissing('input#qrFgColorInput'),
      qrImageTypePng:
        document.querySelector<HTMLInputElement>('input#qrImageTypePng') ||
        elementMissing('input#qrImageTypePng'),
      qrImageTypeSvg:
        document.querySelector<HTMLInputElement>('input#qrImageTypeSvg') ||
        elementMissing('input#qrImageTypeSvg'),
      qrManualMessage:
        document.querySelector<HTMLInputElement>('input#qrManualMessage') ||
        elementMissing('input#qrManualMessage'),
      qrManualMessageText:
        document.querySelector<HTMLInputElement>('input#qrManualMessageText') ||
        elementMissing('input#qrManualMessageText'),
      qrManualMessageTextDiv:
        document.querySelector<HTMLDivElement>('div#qrManualMessageTextDiv') ||
        elementMissing('div#qrManualMessageTextDiv'),
      qrSizeInput:
        document.querySelector<HTMLInputElement>('input#qrSizeInput') ||
        elementMissing('input#qrSizeInput'),
      submitButton:
        document.querySelector<HTMLButtonElement>('button#submitButton') ||
        elementMissing('button#submitButton'),
    };
  }

  /**
   * Initialize QR page.
   */
  public async init(): Promise<void> {
    this.getLocalMessages();
    await applyTheme(window);
    this.initializeDoiInput();
    await this.restoreOptions();
    await this.prepareColorPickers();
    await this.setHistoryMetaPermissions();
    await this.populateHistory();
    this.startListeners();
  }

  /**
   * Attach window/element listeners.
   */
  private startListeners() {
    const saveOptions = this.saveOptions.bind(this);

    this.elements_.doiForm.addEventListener('submit', this.formSubmitHandler.bind(this));
    this.elements_.qrBgTrans.addEventListener('change', this.transparentBgChangeHandler.bind(this));
    this.elements_.qrImageTypePng.addEventListener('click', saveOptions);
    this.elements_.qrImageTypeSvg.addEventListener('click', saveOptions);

    const saveQrDimensionsDebounced = this.saveQrDimensionsDebounced_;
    this.elements_.qrSizeInput.addEventListener('input', saveQrDimensionsDebounced);
    this.elements_.qrBorderInput.addEventListener('input', saveQrDimensionsDebounced);
    this.toggleTitleMessageListeners(true);

    // We want the color changes made in the text input to update Iro as soon as
    // possible. A debounced version of saveOptions is used inside the handler to
    // prevent excessive saves.
    const manualColorChangeHandler = this.manualColorChangeHandler.bind(this);
    this.elements_.qrFgColorInput.addEventListener('input', manualColorChangeHandler);
    this.elements_.qrBgColorInput.addEventListener('input', manualColorChangeHandler);

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
    const refreshHistory = historyRefreshOptions.some(
      (option) => updatedOptions[option] !== undefined
    );
    if (refreshHistory) {
      await this.populateHistory();
      logInfo('History updated');
    }

    const historyPermissionsOptions: (keyof StorageOptions)[] = ['history', 'history_fetch_title'];
    const recheckHistoryPermissions = historyPermissionsOptions.some(
      (option) => updatedOptions[option] !== undefined
    );
    if (recheckHistoryPermissions) {
      await this.setHistoryMetaPermissions();
      logInfo('History permissions updated');
    }
  }

  /**
   * Handle transparent background changes
   */
  private transparentBgChangeHandler(): void {
    this.toggleBgColor();
    this.saveOptions();
  }

  /**
   * Toggle element states after transparent background change
   * @param transparent Whether background transparency is enabled
   */
  private toggleBgColor(transparent?: boolean): void {
    if (transparent === undefined) {
      transparent = this.elements_.qrBgTrans.checked;
    }

    const qrBgColorInput = this.elements_.qrBgColorInput;
    qrBgColorInput.disabled = transparent;
    this.elements_.qrBgColorPicker.style.pointerEvents = transparent ? 'none' : 'auto';

    if (transparent) {
      this.savedBgInputColorStyle_ = qrBgColorInput.getAttribute('style') || '';
      qrBgColorInput.removeAttribute('style');
      qrBgColorInput.classList.add('transparentInput');
    } else {
      qrBgColorInput.classList.remove('transparentInput');
      if (this.savedBgInputColorStyle_) {
        qrBgColorInput.setAttribute('style', this.savedBgInputColorStyle_);
      }
    }
  }

  /**
   * Handle color change from manual text input
   * @param event Input event
   */
  private manualColorChangeHandler(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    const inputElement = event.target;
    if (isHexColor(inputElement.value)) {
      inputElement.classList.remove('badColor');
      if (inputElement.id === 'qrFgColorInput' && this.fgColorPicker_) {
        if (this.iroFgColorChangeHandler_) {
          this.fgColorPicker_.off('color:change', this.iroFgColorChangeHandler_);
        }
        this.fgColorPicker_.color.hexString = inputElement.value;
        inputElement.style.background = `linear-gradient(90deg, var(--bs-body-bg) 50%, ${inputElement.value} 50%)`;
        if (this.iroFgColorChangeHandler_) {
          this.fgColorPicker_.on('color:change', this.iroFgColorChangeHandler_);
        }
      } else if (inputElement.id === 'qrBgColorInput' && this.bgColorPicker_) {
        if (this.iroBgColorChangeHandler_) {
          this.bgColorPicker_.off('color:change', this.iroBgColorChangeHandler_);
        }
        this.bgColorPicker_.color.hexString = inputElement.value;
        inputElement.style.background = `linear-gradient(90deg, var(--bs-body-bg) 50%, ${inputElement.value} 50%)`;
        if (this.iroBgColorChangeHandler_) {
          this.bgColorPicker_.on('color:change', this.iroBgColorChangeHandler_);
        }
      }
      this.saveOptionsDebounced_();
    } else {
      inputElement.classList.add('badColor');
    }
  }

  /**
   * Handle QR size and border changes
   */
  private saveQrDimensions(): void {
    const qrSizeElm = this.elements_.qrSizeInput;
    let qrSize = parseInt(qrSizeElm.value);
    if (isNaN(qrSize)) {
      qrSize = 300;
      qrSizeElm.value = `${qrSize}`;
    } else if (qrSize < 80) {
      qrSize = 80;
      qrSizeElm.value = `${qrSize}`;
    }

    const qrBorderElm = this.elements_.qrBorderInput;
    let qrBorder = parseInt(qrBorderElm.value);
    if (isNaN(qrBorder)) {
      qrBorderElm.value = '0';
      qrBorder = 0;
    } else if (qrSize < 0) {
      qrBorderElm.value = '0';
      qrBorder = 0;
    }

    this.saveOptions();
  }

  /**
   * Get DOI from query paramter and insert into <input> element
   */
  private initializeDoiInput(): void {
    const doi = new URL(location.href).searchParams.get('doi');
    this.elements_.doiInput.value = doi || '';
  }

  /**
   * Restore options from storage
   */
  private async restoreOptions(): Promise<void> {
    const stg = await getOptions('local', [
      'qr_size',
      'qr_border',
      'qr_imgtype',
      'qr_bgtrans',
      'qr_message',
      'qr_title',
    ]);

    if (stg.qr_size === undefined) {
      this.elements_.qrSizeInput.value = '300';
    } else if (stg.qr_size < 80) {
      this.elements_.qrSizeInput.value = '80';
    } else {
      this.elements_.qrSizeInput.value = `${stg.qr_size}`;
    }

    if (stg.qr_border === undefined || stg.qr_border < 0) {
      this.elements_.qrBorderInput.value = '0';
    } else {
      this.elements_.qrBorderInput.value = `${stg.qr_border}`;
    }

    if (stg.qr_imgtype === QrImageType.Png) {
      this.elements_.qrImageTypePng.checked = true;
    } else {
      this.elements_.qrImageTypeSvg.checked = true;
    }

    // If both qr_title and qr_message are true (should not occur),
    // give qr_title precedence
    if (stg.qr_title) {
      this.elements_.qrFetchTitle.checked = true;
      this.elements_.qrManualMessage.disabled = true;
    } else if (stg.qr_message) {
      this.elements_.qrManualMessage.checked = true;
      this.elements_.qrManualMessageTextDiv.hidden = false;
      this.elements_.qrFetchTitle.disabled = true;
    }

    this.elements_.qrBgTrans.checked = !!stg.qr_bgtrans;
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
   * Prepare Iro color pickers
   */
  private async prepareColorPickers(): Promise<void> {
    const stg = await getOptions('local', ['qr_fgcolor', 'qr_bgcolor', 'qr_bgtrans']);

    let qrFgColor = stg.qr_fgcolor;
    if (!qrFgColor || !isHexColor(qrFgColor)) {
      qrFgColor = '#000000';
      await setOptions('local', {qr_fgcolor: qrFgColor});
    }

    let qrBgColor = stg.qr_bgcolor;
    if (!qrBgColor || !isHexColor(qrBgColor)) {
      qrBgColor = '#ffffff';
      await setOptions('local', {qr_bgcolor: qrBgColor});
    }

    const qrFgColorInput = this.elements_.qrFgColorInput;
    qrFgColorInput.value = qrFgColor;
    qrFgColorInput.style.background = `linear-gradient(90deg, var(--bs-body-bg) 50%, ${qrFgColor} 50%)`;

    const qrBgColorInput = this.elements_.qrBgColorInput;
    qrBgColorInput.value = qrBgColor;
    qrBgColorInput.style.background = `linear-gradient(90deg, var(--bs-body-bg) 50%, ${qrBgColor} 50%)`;

    if (stg.qr_bgtrans) {
      this.toggleBgColor(true);
    }

    const {width} = qrFgColorInput.getBoundingClientRect();
    const colorPickerProps = (color: string): Partial<ColorPickerProps> => ({
      padding: 4,
      sliderMargin: 12,
      width: width,
      height: width,
      color,
    });

    const saveOptionsDebounced = this.saveOptionsDebounced_;
    const iroColorChangeHandler = function (this: HTMLInputElement, color: iro.Color): void {
      this.value = color.hexString;
      this.style.background = `linear-gradient(90deg, var(--bs-body-bg) 50%, ${color.hexString} 50%)`;
      saveOptionsDebounced();
    };

    // TODO: Documentation says to use 'new iro.ColorPicker()':
    // https://iro.js.org/guide.html
    // Test whether omission of 'new' causes problems when there are two pickers:
    // https://github.com/jaames/iro.js/issues/109

    this.fgColorPicker_ = iro.ColorPicker('#qrFgColorPicker', colorPickerProps(qrFgColor));
    this.iroFgColorChangeHandler_ = iroColorChangeHandler.bind(qrFgColorInput);
    this.fgColorPicker_.on('color:change', this.iroFgColorChangeHandler_);

    this.bgColorPicker_ = iro.ColorPicker('#qrBgColorPicker', colorPickerProps(qrBgColor));
    this.iroBgColorChangeHandler_ = iroColorChangeHandler.bind(qrBgColorInput);
    this.bgColorPicker_.on('color:change', this.iroBgColorChangeHandler_);
  }

  /**
   * Async method to save options to storage
   */
  private async saveOptionsAsync(): Promise<void> {
    const options: StorageOptions = {
      qr_bgtrans: this.elements_.qrBgTrans.checked,
      qr_size: parseInt(this.elements_.qrSizeInput.value),
      qr_border: parseInt(this.elements_.qrBorderInput.value),
      qr_fgcolor: this.elements_.qrFgColorInput.value,
      qr_bgcolor: this.elements_.qrBgColorInput.value,
      qr_message: this.elements_.qrManualMessage.checked,
      qr_title: this.elements_.qrFetchTitle.checked,
    };

    const checkedQrImageTypeRadio = document.querySelector<HTMLInputElement>(
      'input[name="qrImageType"]:checked'
    );
    if (checkedQrImageTypeRadio) {
      if (isQrImageType(checkedQrImageTypeRadio.value)) {
        options.qr_imgtype = checkedQrImageTypeRadio.value;
      }
    }

    await setOptions('local', options);
  }

  /**
   * Sync method for save options (only meant to be used when waiting for
   * promise to resolve is unnecessary).
   */
  private saveOptions(): void {
    this.saveOptionsAsync().catch((error) => {
      logError('Failed to save options', error);
    });
  }

  /**
   * Add/Remove fetch/manual title option change listeners
   * @param enable Whether to add or remove change listeners
   */
  private toggleTitleMessageListeners(enable: boolean): void {
    const qrFetchTitle = this.elements_.qrFetchTitle;
    const qrManualMessage = this.elements_.qrManualMessage;

    if (this.qrFetchTitleChangeHandler_ === undefined) {
      this.qrFetchTitleChangeHandler_ = this.titleMessageHandler.bind(this);
    }
    if (this.qrManualMessageChangeHandler_ === undefined) {
      this.qrManualMessageChangeHandler_ = this.titleMessageHandler.bind(this);
    }

    if (enable) {
      qrFetchTitle.addEventListener('change', this.qrFetchTitleChangeHandler_);
      qrManualMessage.addEventListener('change', this.qrManualMessageChangeHandler_);
    } else {
      qrFetchTitle.removeEventListener('change', this.qrFetchTitleChangeHandler_);
      qrManualMessage.removeEventListener('change', this.qrManualMessageChangeHandler_);
    }
  }

  /**
   * Handle fetch/manual title option changes
   * @param event Change event
   */
  private titleMessageHandler(event: Event): void {
    const elementId = event.target instanceof HTMLElement ? event.target.id : undefined;
    this.titleMessageHandlerAsync(elementId).catch((error) => {
      logError('Failed to handle title message change', error);
    });
  }

  /**
   * Async handler for fetch/manual title option changes
   * @param elementId ID of element that triggered the change
   */
  private async titleMessageHandlerAsync(elementId?: string): Promise<void> {
    this.toggleTitleMessageListeners(false);

    const qrFetchTitle = this.elements_.qrFetchTitle;
    const qrManualMessage = this.elements_.qrManualMessage;
    const qrManualMessageTextDiv = this.elements_.qrManualMessageTextDiv;

    if (elementId === 'qrManualMessage') {
      if (qrManualMessage.checked) {
        qrFetchTitle.checked = false;
        qrFetchTitle.disabled = true;
        qrManualMessageTextDiv.hidden = false;
      } else {
        qrFetchTitle.disabled = false;
        qrManualMessageTextDiv.hidden = true;
      }
      await this.saveOptionsAsync();
    } else {
      if (qrFetchTitle.checked) {
        // Permissions will be cleaned when last QR/Citation tab is closed
        const granted = await requestMetaPermissions();
        if (granted) {
          qrManualMessage.checked = false;
          qrManualMessage.disabled = true;
          qrManualMessageTextDiv.hidden = true;
          await this.saveOptionsAsync();
        } else {
          qrFetchTitle.checked = false;
        }
      } else {
        qrManualMessage.disabled = false;
        await this.saveOptionsAsync();
      }
    }

    this.toggleTitleMessageListeners(true);
  }

  /**
   * Clear message and QR spaces
   */
  private resetSpace(): void {
    this.elements_.notifyDiv.classList.remove('advanced');
    this.elements_.notifyDiv.innerHTML = '';
    this.elements_.notifyDiv.hidden = true;
    this.elements_.qrDiv.innerHTML = '';
    this.elements_.qrDiv.hidden = true;
  }

  /**
   * Print a simple notification
   * @param message Message
   */
  private simpleNotification(message: string): void {
    this.resetSpace();
    this.elements_.notifyDiv.innerHTML = message;
    this.elements_.notifyDiv.hidden = false;
  }

  /**
   * Print an advanced notification
   * @param fragment Document fragment
   */
  private advancedNotification(fragment: DocumentFragment): void {
    this.resetSpace();
    this.elements_.notifyDiv.classList.add('advanced');
    this.elements_.notifyDiv.appendChild(fragment);
    this.elements_.notifyDiv.hidden = false;
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

    let qrSize = parseInt(this.elements_.qrSizeInput.value);
    let qrBorder = parseInt(this.elements_.qrBorderInput.value);
    const fgColor = this.elements_.qrFgColorInput.value;
    const bgColor = this.elements_.qrBgTrans.checked ? null : this.elements_.qrBgColorInput.value;
    const qrImageTypeValue = document.querySelector<HTMLInputElement>(
      'input[name="qrImageType"]:checked'
    )?.value;
    const qrImageType = isQrImageType(qrImageTypeValue) ? qrImageTypeValue : QrImageType.Png;

    if (isNaN(qrSize)) {
      qrSize = 300;
      this.elements_.qrSizeInput.value = `${qrSize}`;
    } else if (qrSize < 80) {
      qrSize = 80;
      this.elements_.qrSizeInput.value = `${qrSize}`;
    }

    if (isNaN(qrBorder) || qrBorder < 0) {
      qrBorder = 0;
      this.elements_.qrBorderInput.value = `${qrBorder}`;
    }

    const qrParms: CreateQrParams = {
      size: qrSize,
      border: qrBorder,
      fgColor,
      bgColor,
      imgType: qrImageType,
      text: '',
    };

    this.insertQr(doiInput, qrParms).catch((error) => {
      this.simpleNotification(chrome.i18n.getMessage('qrGenerationFailed'));
      logError('Failed to insert QR', error);
    });
  }

  /**
   * Handle title retrieval, generate a QR image, linkify it,
   * and finally insert it into the page.
   * @param doi DOI
   * @param qrParms QR image creation parameters
   */
  private async insertQr(doi: string, qrParms: CreateQrParams): Promise<void> {
    this.resetSpace();

    let messageToEncode = this.defaultDoiResolver_;
    if (/^10\//.test(doi)) {
      messageToEncode += doi.replace(/^10\//, '');
    } else {
      messageToEncode += doi;
    }

    this.simpleNotification('Loading...');

    if (this.elements_.qrFetchTitle.checked) {
      // These permissions will be cleaned when last QR/Citation tab is closed
      const granted = await requestMetaPermissions();

      const title = await getSavedDoiTitle(doi);
      if (title) {
        logInfo('Found title in history');
        messageToEncode = title + '\n' + messageToEncode;
        this.updateMessage(messageToEncode, TitleRetrievalStatus.Found);
        qrParms.text = messageToEncode;
        await this.createQrImage(qrParms);
        return;
      }

      if (granted) {
        logInfo('Fetching title from network');
        const title = await fetchDoiTitle(doi);

        if (title) {
          messageToEncode = title + '\n' + messageToEncode;
          this.updateMessage(messageToEncode, TitleRetrievalStatus.Found);
        } else {
          this.updateMessage(messageToEncode, TitleRetrievalStatus.Missing);
        }
        qrParms.text = messageToEncode;
        await this.createQrImage(qrParms);

        try {
          await recordDoi({doi, title: title || '', save: false});
        } catch (ex) {
          logError('Unable to record DOI', ex);
        }
      } else {
        logInfo('Permissions not granted for title fetch');
        this.updateMessage(messageToEncode, TitleRetrievalStatus.Disabled);
        qrParms.text = messageToEncode;
        await this.createQrImage(qrParms);

        try {
          await recordDoi({doi, title: '', save: false}, false);
        } catch (ex) {
          logError('Unable to record DOI', ex);
        }
      }
    } else {
      if (this.needsHistoryMetaPermissions_) {
        await requestMetaPermissions();
      }

      if (this.elements_.qrManualMessage.checked) {
        const titleString = this.elements_.qrManualMessageText.value;
        if (titleString) {
          messageToEncode = titleString + '\n' + messageToEncode;
        }
      }
      this.updateMessage(messageToEncode, TitleRetrievalStatus.Disabled);
      qrParms.text = messageToEncode;
      await this.createQrImage(qrParms);

      await queueRecordDoi(doi);
    }
  }

  /**
   * Transform a qrcodegen QrCode object into an <svg> element
   * @param qr qrcodegen QrCode object
   * @param qrParams QR image creation parameters
   */
  private toSvg(
    qr: import('./qrcodegen/qrcodegen').qrcodegen.QrCode,
    qrParams: CreateQrParams
  ): SVGElement {
    const border = qrParams.border;
    const viewBox = qr.size + border * 2;

    const parts: string[] = [];
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) parts.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    }

    const ns = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('version', '1.1');
    svg.setAttribute('viewBox', `0 0 ${viewBox} ${viewBox}`);
    svg.setAttribute('stroke', 'none');
    svg.setAttribute('width', `${qrParams.size}`);
    svg.setAttribute('height', `${qrParams.size}`);

    // Background
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    if (qrParams.bgColor === null) {
      rect.setAttribute('fill', '#ffffff');
      rect.setAttribute('fill-opacity', '0.0');
    } else {
      rect.setAttribute('fill', qrParams.bgColor);
    }

    // Foreground
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('fill', qrParams.fgColor);
    path.setAttribute('d', parts.join(' '));

    svg.appendChild(rect);
    svg.appendChild(path);
    return svg;
  }

  /**
   * Create QR image and insert into page
   * @param qrParms QR image creation parameters
   */
  private async createQrImage(qrParms: CreateQrParams): Promise<void> {
    const {QrCode} = (await import('./qrcodegen/qrcodegen')).qrcodegen;
    const ecl = QrCode.Ecc.MEDIUM;
    const qr = QrCode.encodeText(qrParms.text, ecl);
    const svg = this.toSvg(qr, qrParms);
    const linkifyQrImage = this.linkifyQrImage.bind(this);

    const svgDataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.outerHTML);
    if (qrParms.imgType === QrImageType.Png) {
      const canvas = document.createElement('canvas');
      canvas.width = qrParms.size;
      canvas.height = qrParms.size;
      this.elements_.qrDiv.appendChild(canvas);

      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = function () {
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          linkifyQrImage(qrParms.imgType, canvas.toDataURL('image/png'));
        }
      };
      img.src = svgDataUrl;
    } else {
      this.elements_.qrDiv.appendChild(svg);
      linkifyQrImage(qrParms.imgType, svgDataUrl);
    }
  }

  /**
   * Update the encoded message output
   * @param message Encoded message
   * @param titleRetrieval Status of title retrieval
   */
  private updateMessage(message: string, titleRetrieval: TitleRetrievalStatus): void {
    let titleNotice = '';

    switch (titleRetrieval) {
      case TitleRetrievalStatus.Found:
        titleNotice = chrome.i18n.getMessage('qrTitleSuccess');
        break;
      case TitleRetrievalStatus.Missing:
        titleNotice = chrome.i18n.getMessage('qrTitleFailure');
        break;
      case TitleRetrievalStatus.Disabled:
      default:
        titleNotice = chrome.i18n.getMessage('qrDisabled');
        break;
    }

    const template = this.elements_.notify_template;

    const clone = document.importNode(template.content, true);
    const headings = clone.querySelectorAll('.notifyHeading');
    const contents = clone.querySelectorAll('.notifyContent');

    headings[0].innerHTML = chrome.i18n.getMessage('qrTitleStatus');
    contents[0].innerHTML = titleNotice;
    headings[1].innerHTML = chrome.i18n.getMessage('qrMessageEncoded');
    contents[1].innerHTML = message;

    this.advancedNotification(clone);
  }

  /**
   * Wrap QR image with a download anchor
   * @param imgType Image type
   * @param dataUrl Base64 data URL
   */
  private linkifyQrImage(imgType: QrImageType, dataUrl: string): void {
    const qrDiv = this.elements_.qrDiv;
    const qrImg = qrDiv.firstChild;
    if (qrImg === null) {
      return;
    }

    const saveLink = document.createElement('a');
    saveLink.id = 'qrImageSaveLink';
    saveLink.href = dataUrl;
    const filename = imgType === QrImageType.Png ? 'qrImage.png' : 'qrImage.svg';
    saveLink.download = filename;

    saveLink.appendChild(qrImg);
    qrDiv.appendChild(saveLink);

    this.elements_.qrDiv.hidden = false;
  }

  /**
   * Get localization strings and populate their corresponding elements' HTML.
   */
  private getLocalMessages(): void {
    const message = chrome.i18n.getMessage('qrHeading');
    document.title = message;

    const messageIds = [
      'doiInputLabel',
      'qrBgColorInputLabel',
      'qrBgTransLabel',
      'qrBorderInputLabel',
      'qrFetchTitleLabel',
      'qrFgColorInputLabel',
      'qrHeading',
      'qrImageTypeLabel',
      'qrManualMessageLabel',
      'qrManualMessageTextLabel',
      'qrSizeInputLabel',
      'qrSubHeading',
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

/**
 * @license Apache-2.0
 */

import {
  HistoryDoi,
  StorageOptions,
  clearOptions,
  getDefaultOptions,
  getOptions,
  isCustomResolverSelection,
  isHistorySort,
  isOmniboxTab,
  setOptions,
  isDisplayTheme,
} from './lib/options';
import {MessageCmd, isInternalMessage, isSettingsUpdatedMessage} from './lib/messaging';
import {
  removeContentScriptPermissions,
  requestContentScriptPermissions,
  requestMetaPermissions,
} from './lib/permissions';
import {debounce, isRecord, isValidDoi, sortHistoryEntries} from './lib/utils';
import {testAutolinkExclusion} from './lib/autolink';
import {ContextMenuId, updateContextMenu} from './lib/context_menu';
import {fetchDoiTitles} from './lib/metadata';
import {logError, logInfo, logWarn} from './lib/logger';
import {applyTheme} from './utils';
import {recordDois} from './lib/history';

enum UrlHashPage {
  Options = 'tab-options',
  History = 'tab-history',
  About = 'tab-about',
}

interface SaveMapItem {
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  handler: () => void;
  events: (keyof HTMLElementEventMap)[];
}

document.addEventListener(
  'DOMContentLoaded',
  function () {
    new DoiOptions().init().catch((error) => {
      logError('Init failed', error);
    });
  },
  false
);

class DoiOptions {
  private defaultDoiResolver_: string;
  private storageListenerStatus_: boolean;

  private elements_: {
    aboutTab: HTMLButtonElement;
    alExclusions: HTMLDivElement;
    alRewriteLinks: HTMLDivElement;
    autolink: HTMLInputElement;
    autolinkExclusions: HTMLTextAreaElement;
    autolinkRewrite: HTMLInputElement;
    autolinkSubOptions: HTMLDivElement;
    autolinkTestExclusion: HTMLInputElement;
    autolinkTestExclusionResult: HTMLSpanElement;
    context: HTMLInputElement;
    contextMatch: HTMLInputElement;
    contextSubOptions: HTMLDivElement;
    crAutolink: HTMLSelectElement;
    crBubble: HTMLSelectElement;
    crContext: HTMLSelectElement;
    crHistory: HTMLSelectElement;
    crOmnibox: HTMLSelectElement;
    customResolver: HTMLInputElement;
    customResolverSubOptions: HTMLDivElement;
    doiOutputUrlExample: HTMLSpanElement;
    doiResolverInput: HTMLInputElement;
    doiResolverInputReset: HTMLButtonElement;
    doiResolverOutput: HTMLSpanElement;
    extensionVersion: HTMLSpanElement;
    history: HTMLInputElement;
    historyClear: HTMLButtonElement;
    historyFetchTitle: HTMLInputElement;
    historyImportFailure: HTMLAnchorElement;
    historyImportInput: HTMLTextAreaElement;
    historyImportSubmit: HTMLButtonElement;
    historyLength: HTMLInputElement;
    historyNotice: HTMLDivElement;
    historySeparator: HTMLTableRowElement;
    historyShowSave: HTMLInputElement;
    historyShowTitles: HTMLInputElement;
    historySortBy: HTMLSelectElement;
    historySpinner: HTMLSpanElement;
    historySubOptions: HTMLDivElement;
    historyTab: HTMLButtonElement;
    historyTitleRefresh: HTMLButtonElement;
    history_entry_template: HTMLTemplateElement;
    historyImportModal: HTMLDivElement;
    infoModal: HTMLDivElement;
    meta: HTMLInputElement;
    omniboxOpento: HTMLSelectElement;
    optionsTab: HTMLButtonElement;
    shortDoiOutputUrlExample: HTMLSpanElement;
    shortDoiResolverInput: HTMLInputElement;
    shortDoiResolverInputReset: HTMLButtonElement;
    shortDoiResolverOutput: HTMLSpanElement;
    syncData: HTMLInputElement;
    syncDataWipeButton: HTMLButtonElement;
    theme: HTMLSelectElement;
  };

  private handlers_: {
    autolinkOutputTestResults: () => void;
    dbUpdateHistoryLength: () => void;
    dbSaveOptions: () => void;
    deleteHistoryEntry: (event: Event) => void;
    saveOptions: () => void;
    saveHistoryEntry: (event: Event) => void;
    setAutolink: () => void;
    setContextMenu: () => void;
    setContextMenuMatch: () => void;
    setCrPreviews: () => void;
    updateHistoryTitlePermissions: () => void;
  };

  constructor() {
    this.defaultDoiResolver_ = getDefaultOptions()['doi_resolver'];
    this.storageListenerStatus_ = false;

    this.handlers_ = {
      autolinkOutputTestResults: () => {
        this.outputAutolinkExclusionTestResults().catch((error) => {
          logError('Failed to test autolink exclusion', error);
        });
      },
      dbUpdateHistoryLength: debounce(() => {
        this.updateHistoryLength().catch((error) => {
          logError('Failed to update history length', error);
        });
      }, 750),
      dbSaveOptions: debounce(() => {
        this.saveOptions().catch((error) => {
          logError('Failed to save options', error);
        });
      }, 750),
      deleteHistoryEntry: (event: Event) => {
        this.deleteHistoryEntry(event).catch((error) => {
          logError('Failed to save history entry', error);
        });
      },
      saveOptions: () => {
        this.saveOptions().catch((error) => {
          logError('Failed to save options', error);
        });
      },
      saveHistoryEntry: (event: Event) => {
        this.saveHistoryEntry(event).catch((error) => {
          logError('Failed to save history entry', error);
        });
      },
      setAutolink: () => {
        this.setAutolink().catch((error) => {
          logError('Failed to set autolink option', error);
        });
      },
      setContextMenu: () => {
        this.setContextMenu().catch((error) => {
          logError('Failed to set context menu option', error);
        });
      },
      setContextMenuMatch: () => {
        this.setContextMenuMatch().catch((error) => {
          logError('Failed to set context menu match option', error);
        });
      },
      setCrPreviews: this.setCrPreviews.bind(this),
      updateHistoryTitlePermissions: () => {
        this.updateHistoryTitlePermissions().catch((error) => {
          logError('Failed to update history title permissions', error);
        });
      },
    };

    const elementMissing = (selector: string) => {
      throw new Error(`Required element is missing from the page: ${selector}`);
    };
    this.elements_ = {
      aboutTab:
        document.querySelector<HTMLButtonElement>('button#pills-about-tab') ||
        elementMissing('button#pills-about-tab'),
      alExclusions:
        document.querySelector<HTMLDivElement>('div#alExclusions') ||
        elementMissing('div#alExclusions'),
      alRewriteLinks:
        document.querySelector<HTMLDivElement>('div#alRewriteLinks') ||
        elementMissing('div#alRewriteLinks'),
      autolink:
        document.querySelector<HTMLInputElement>('input#autolink') ||
        elementMissing('input#autolink'),
      autolinkExclusions:
        document.querySelector<HTMLTextAreaElement>('textarea#autolinkExclusions') ||
        elementMissing('textarea#autolinkExclusions'),
      autolinkRewrite:
        document.querySelector<HTMLInputElement>('input#autolinkRewrite') ||
        elementMissing('input#autolinkRewrite'),
      autolinkSubOptions:
        document.querySelector<HTMLDivElement>('div#autolinkSubOptions') ||
        elementMissing('div#autolinkSubOptions'),
      autolinkTestExclusion:
        document.querySelector<HTMLInputElement>('input#autolinkTestExclusion') ||
        elementMissing('input#autolinkTestExclusion'),
      autolinkTestExclusionResult:
        document.querySelector<HTMLSpanElement>('span#autolinkTestExclusionResult') ||
        elementMissing('span#autolinkTestExclusionResult'),
      context:
        document.querySelector<HTMLInputElement>('input#context') ||
        elementMissing('input#context'),
      contextMatch:
        document.querySelector<HTMLInputElement>('input#contextMatch') ||
        elementMissing('input#contextMatch'),
      contextSubOptions:
        document.querySelector<HTMLDivElement>('div#contextSubOptions') ||
        elementMissing('div#contextSubOptions'),
      crAutolink:
        document.querySelector<HTMLSelectElement>('select#crAutolink') ||
        elementMissing('select#crAutolink'),
      crBubble:
        document.querySelector<HTMLSelectElement>('select#crBubble') ||
        elementMissing('select#crBubble'),
      crContext:
        document.querySelector<HTMLSelectElement>('select#crContext') ||
        elementMissing('select#crContext'),
      crHistory:
        document.querySelector<HTMLSelectElement>('select#crHistory') ||
        elementMissing('select#crHistory'),
      crOmnibox:
        document.querySelector<HTMLSelectElement>('select#crOmnibox') ||
        elementMissing('select#crOmnibox'),
      customResolver:
        document.querySelector<HTMLInputElement>('input#customResolver') ||
        elementMissing('input#customResolver'),
      customResolverSubOptions:
        document.querySelector<HTMLDivElement>('div#customResolverSubOptions') ||
        elementMissing('div#customResolverSubOptions'),
      doiOutputUrlExample:
        document.querySelector<HTMLSpanElement>('span#doiOutputUrlExample') ||
        elementMissing('span#doiOutputUrlExample'),
      doiResolverInput:
        document.querySelector<HTMLInputElement>('input#doiResolverInput') ||
        elementMissing('input#doiResolverInput'),
      doiResolverInputReset:
        document.querySelector<HTMLButtonElement>('button#doiResolverInputReset') ||
        elementMissing('button#doiResolverInputReset'),
      doiResolverOutput:
        document.querySelector<HTMLSpanElement>('span#doiResolverOutput') ||
        elementMissing('span#doiResolverOutput'),
      extensionVersion:
        document.querySelector<HTMLSpanElement>('span#extensionVersion') ||
        elementMissing('span#extensionVersion'),
      history:
        document.querySelector<HTMLInputElement>('input#history') ||
        elementMissing('input#history'),
      historyClear:
        document.querySelector<HTMLButtonElement>('button#historyClear') ||
        elementMissing('button#historyClear'),
      historyFetchTitle:
        document.querySelector<HTMLInputElement>('input#historyFetchTitle') ||
        elementMissing('input#historyFetchTitle'),
      historyImportFailure:
        document.querySelector<HTMLAnchorElement>('a#historyImportFailure') ||
        elementMissing('a#historyImportFailure'),
      historyImportInput:
        document.querySelector<HTMLTextAreaElement>('textarea#historyImportInput') ||
        elementMissing('textarea#historyImportInput'),
      historyImportSubmit:
        document.querySelector<HTMLButtonElement>('button#historyImportSubmit') ||
        elementMissing('button#historyImportSubmit'),
      historyLength:
        document.querySelector<HTMLInputElement>('input#historyLength') ||
        elementMissing('input#historyLength'),
      historyNotice:
        document.querySelector<HTMLDivElement>('div#historyNotice') ||
        elementMissing('div#historyNotice'),
      historySeparator:
        document.querySelector<HTMLTableRowElement>('tr#historySeparator') ||
        elementMissing('tr#historySeparator'),
      historyShowSave:
        document.querySelector<HTMLInputElement>('input#historyShowSave') ||
        elementMissing('input#historyShowSave'),
      historyShowTitles:
        document.querySelector<HTMLInputElement>('input#historyShowTitles') ||
        elementMissing('input#historyShowTitles'),
      historySortBy:
        document.querySelector<HTMLSelectElement>('select#historySortBy') ||
        elementMissing('select#historySortBy'),
      historySpinner:
        document.querySelector<HTMLSpanElement>('span#historySpinner') ||
        elementMissing('span#historySpinner'),
      historySubOptions:
        document.querySelector<HTMLDivElement>('div#historySubOptions') ||
        elementMissing('div#historySubOptions'),
      historyTab:
        document.querySelector<HTMLButtonElement>('button#pills-history-tab') ||
        elementMissing('button#pills-history-tab'),
      historyTitleRefresh:
        document.querySelector<HTMLButtonElement>('button#historyTitleRefresh') ||
        elementMissing('button#historyTitleRefresh'),
      history_entry_template:
        document.querySelector<HTMLTemplateElement>('template#history_entry_template') ||
        elementMissing('template#history_entry_template'),
      historyImportModal:
        document.querySelector<HTMLDivElement>('div#historyImportModal') ||
        elementMissing('div#historyImportModal'),
      infoModal:
        document.querySelector<HTMLDivElement>('div#infoModal') || elementMissing('div#infoModal'),
      meta: document.querySelector<HTMLInputElement>('input#meta') || elementMissing('input#meta'),
      omniboxOpento:
        document.querySelector<HTMLSelectElement>('select#omniboxOpento') ||
        elementMissing('select#omniboxOpento'),
      optionsTab:
        document.querySelector<HTMLButtonElement>('button#pills-options-tab') ||
        elementMissing('button#pills-options-tab'),
      shortDoiOutputUrlExample:
        document.querySelector<HTMLSpanElement>('span#shortDoiOutputUrlExample') ||
        elementMissing('span#shortDoiOutputUrlExample'),
      shortDoiResolverInput:
        document.querySelector<HTMLInputElement>('input#shortDoiResolverInput') ||
        elementMissing('input#shortDoiResolverInput'),
      shortDoiResolverInputReset:
        document.querySelector<HTMLButtonElement>('button#shortDoiResolverInputReset') ||
        elementMissing('button#shortDoiResolverInputReset'),
      shortDoiResolverOutput:
        document.querySelector<HTMLSpanElement>('span#shortDoiResolverOutput') ||
        elementMissing('span#shortDoiResolverOutput'),
      syncData:
        document.querySelector<HTMLInputElement>('input#syncData') ||
        elementMissing('input#syncData'),
      syncDataWipeButton:
        document.querySelector<HTMLButtonElement>('button#syncDataWipeButton') ||
        elementMissing('button#syncDataWipeButton'),
      theme:
        document.querySelector<HTMLSelectElement>('select#theme') || elementMissing('select#theme'),
    };
  }

  /**
   * Initialize options page.
   */
  async init(): Promise<void> {
    this.getLocalMessages();
    this.initWebStoreLink();
    await applyTheme(window);
    this.openTabByHash();
    this.startClickListeners();
    await this.restoreOptions();
    await this.populateHistory();
    this.startRuntimeListeners();
  }

  /**
   * Read #hash from URL and open corresponding tab
   */
  openTabByHash() {
    const hash = location.hash ? location.hash.substring(1) : '';
    if (hash === UrlHashPage.About) {
      this.elements_.aboutTab.click();
    } else if (hash === UrlHashPage.History) {
      this.elements_.historyTab.click();
    } else if (hash === UrlHashPage.Options) {
      // Do nothing
    } else if (location.hash) {
      location.hash = '';
    }
  }

  /**
   * Start listeners for runtime messages
   */
  startRuntimeListeners(): void {
    chrome.runtime.onMessage.addListener(this.runtimeMessageHandler.bind(this));
  }

  /**
   * Start click listeners
   */
  startClickListeners(): void {
    const tabChangeHandler = (event: Event) => {
      const target = event.currentTarget;
      if (target instanceof HTMLButtonElement) {
        location.hash = target.dataset.hash || '';
      }
    };
    this.elements_.aboutTab.addEventListener('show.bs.tab', tabChangeHandler);
    this.elements_.historyTab.addEventListener('show.bs.tab', tabChangeHandler);
    this.elements_.optionsTab.addEventListener('show.bs.tab', tabChangeHandler);

    const defaultDoiResolver = this.defaultDoiResolver_;
    const handleDoiResolverReset = function (this: HTMLInputElement) {
      if (this.value !== defaultDoiResolver) {
        this.value = defaultDoiResolver;
        this.dispatchEvent(new Event('change'));
      }
    };
    this.elements_.doiResolverInputReset.addEventListener(
      'click',
      handleDoiResolverReset.bind(this.elements_.doiResolverInput)
    );
    this.elements_.shortDoiResolverInputReset.addEventListener(
      'click',
      handleDoiResolverReset.bind(this.elements_.shortDoiResolverInput)
    );

    this.elements_.historyTitleRefresh.addEventListener('click', () => {
      this.findMissingHistoryTitles().catch((error) => {
        logError('Failed to handle history titles request', error);
      });
    });
    this.elements_.historyClear.addEventListener('click', () => {
      this.deleteHistory().catch((error) => {
        logError('Failed to delete history', error);
      });
    });

    this.elements_.syncDataWipeButton.addEventListener('click', () => {
      this.elements_.syncData.checked = false;
      clearOptions('sync').catch((error) => {
        logError('Failed to clear sync storage', error);
      });
    });

    this.elements_.historyImportSubmit.addEventListener('click', () => {
      this.importDois().catch((error) => {
        logError('Failed to import DOIs into history', error);
      });
    });

    // Bootstrap types are incomplete. Event types not available.
    const infoModal = this.elements_.infoModal;
    infoModal.addEventListener('show.bs.modal', function (event: unknown) {
      if (!isRecord(event)) {
        return;
      }

      const trigger = event.relatedTarget;
      if (!(trigger instanceof HTMLElement)) {
        return;
      }

      const titleElm = infoModal.querySelector('.modal-title');
      const bodyElm = infoModal.querySelector('.modal-body');
      if (!titleElm || !bodyElm) {
        logWarn('Unable to update modal because elements are missing');
        return;
      }

      const title = chrome.i18n.getMessage(trigger.dataset.modalTitle || '');
      const body = chrome.i18n.getMessage(trigger.dataset.modalBody || '');
      if (!title || !body) {
        logWarn('Unable to update modal because message not defined');
        return;
      }

      titleElm.innerHTML = title;
      bodyElm.innerHTML = body;
    });

    infoModal.addEventListener('hidden.bs.modal', function () {
      const titleElm = infoModal.querySelector('.modal-title');
      const bodyElm = infoModal.querySelector('.modal-body');
      if (!titleElm || !bodyElm) {
        logWarn('Unable to update modal because elements are missing');
        return;
      }

      titleElm.innerHTML = 'Info';
      bodyElm.innerHTML = '';
    });

    const historyImportModal = this.elements_.historyImportModal;
    historyImportModal.addEventListener('shown.bs.modal', () => {
      this.elements_.historyImportInput.focus();
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
          this.handleSettingsUpdate(message.data.options, message.data.forceUpdate).catch(
            (error) => {
              logError('Failed to handle settings update', error);
            }
          );
        }
        break;
      default:
        break;
    }
  }

  /**
   * Get a map of elements and their corresponding save handlers and
   * triggering events.
   */
  getSaveMap(): SaveMapItem[] {
    return [
      {
        element: this.elements_.history,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.historyShowSave,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.historyShowTitles,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.historySortBy,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.historyLength,
        handler: this.handlers_.dbUpdateHistoryLength,
        events: ['change'],
      },
      {
        element: this.elements_.historyFetchTitle,
        handler: this.handlers_.updateHistoryTitlePermissions,
        events: ['change'],
      },
      {
        element: this.elements_.context,
        handler: this.handlers_.setContextMenu,
        events: ['change'],
      },
      {
        element: this.elements_.contextMatch,
        handler: this.handlers_.setContextMenuMatch,
        events: ['change'],
      },
      {
        element: this.elements_.meta,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.autolink,
        handler: this.handlers_.setAutolink,
        events: ['change'],
      },
      {
        element: this.elements_.autolinkRewrite,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.customResolver,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.crAutolink,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.crBubble,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.crContext,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.crHistory,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.crOmnibox,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.doiResolverInput,
        handler: this.handlers_.dbSaveOptions,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.doiResolverInput,
        handler: this.handlers_.setCrPreviews,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.shortDoiResolverInput,
        handler: this.handlers_.dbSaveOptions,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.shortDoiResolverInput,
        handler: this.handlers_.setCrPreviews,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.omniboxOpento,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.autolinkExclusions,
        handler: this.handlers_.dbSaveOptions,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.autolinkExclusions,
        handler: this.handlers_.autolinkOutputTestResults,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.autolinkTestExclusion,
        handler: this.handlers_.autolinkOutputTestResults,
        events: ['input', 'change'],
      },
      {
        element: this.elements_.syncData,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
      {
        element: this.elements_.theme,
        handler: this.handlers_.saveOptions,
        events: ['change'],
      },
    ];
  }

  /**
   * Start listening for changes
   */
  startChangeListeners() {
    this.getSaveMap().forEach((mapItem) => {
      mapItem.events.forEach((event) => {
        mapItem.element.addEventListener(event, mapItem.handler);
      });
    });
  }

  /**
   * Stop listening for changes
   */
  haltChangeListeners() {
    this.getSaveMap().forEach((mapItem) => {
      mapItem.events.forEach((event) => {
        mapItem.element.removeEventListener(event, mapItem.handler);
      });
    });
  }

  /**
   * Start listening for history changes
   */
  startHistoryChangeListeners() {
    Array.from(document.getElementsByClassName('history_input_save')).forEach((element) => {
      element.addEventListener('change', this.handlers_.saveHistoryEntry);
    });
    Array.from(document.getElementsByClassName('history_input_delete')).forEach((element) => {
      element.addEventListener('click', this.handlers_.deleteHistoryEntry);
    });
  }

  /**
   * Stop listening for history changes
   */
  haltHistoryChangeListeners() {
    Array.from(document.getElementsByClassName('history_input_save')).forEach((element) => {
      element.removeEventListener('change', this.handlers_.saveHistoryEntry);
    });
    Array.from(document.getElementsByClassName('history_input_delete')).forEach((element) => {
      element.removeEventListener('click', this.handlers_.deleteHistoryEntry);
    });
  }

  /**
   * Save individual options
   * @param options Storage options
   */
  async saveIndividualOptions(options: StorageOptions): Promise<void> {
    this.storageListener(false);
    await setOptions('local', options);
  }

  /**
   * Save all options based on page state
   */
  async saveOptions(): Promise<void> {
    this.optionsDisplayUpdates();

    const options: StorageOptions = {
      auto_link_rewrite: this.elements_.autolinkRewrite.checked,
      history: this.elements_.history.checked,
      history_showsave: this.elements_.historyShowSave.checked,
      history_showtitles: this.elements_.historyShowTitles.checked,
      history_sortby: isHistorySort(this.elements_.historySortBy.value)
        ? this.elements_.historySortBy.value
        : undefined,
      history_length: Number(this.elements_.historyLength.value),
      history_fetch_title: this.elements_.historyFetchTitle.checked,
      context_menu: this.elements_.context.checked,
      meta_buttons: this.elements_.meta.checked,
      custom_resolver: this.elements_.customResolver.checked,
      cr_autolink: isCustomResolverSelection(this.elements_.crAutolink.value)
        ? this.elements_.crAutolink.value
        : undefined,
      cr_bubble: isCustomResolverSelection(this.elements_.crBubble.value)
        ? this.elements_.crBubble.value
        : undefined,
      cr_context: isCustomResolverSelection(this.elements_.crContext.value)
        ? this.elements_.crContext.value
        : undefined,
      cr_history: isCustomResolverSelection(this.elements_.crHistory.value)
        ? this.elements_.crHistory.value
        : undefined,
      cr_omnibox: isCustomResolverSelection(this.elements_.crOmnibox.value)
        ? this.elements_.crOmnibox.value
        : undefined,
      doi_resolver: this.elements_.doiResolverInput.value,
      shortdoi_resolver: this.elements_.shortDoiResolverInput.value,
      omnibox_tab: isOmniboxTab(this.elements_.omniboxOpento.value)
        ? this.elements_.omniboxOpento.value
        : undefined,
      sync_data: this.elements_.syncData.checked,
      theme: isDisplayTheme(this.elements_.theme.value) ? this.elements_.theme.value : undefined,
    };

    // Strip protocol from user-entered autolink exclusions before saving
    options.autolink_exclusions = this.elements_.autolinkExclusions.value
      .split('\n')
      .map((str) => str.replace(/^\s*https?:\/\//i, '').trim())
      .filter(Boolean);

    // If history is disabled, remove all history entries
    if (!options.history) {
      options.recorded_dois = [];
      this.haltHistoryChangeListeners();
      this.removeAllHistoryEntries();
    }

    await this.saveIndividualOptions(options);

    // Restore autolink exclusions if it was modified before saving
    if (this.elements_.autolinkExclusions.value.trim() !== options.autolink_exclusions.join('\n')) {
      this.haltChangeListeners();
      this.elements_.autolinkExclusions.value = options.autolink_exclusions.join('\n');
      this.startChangeListeners();
    }
  }

  /**
   * Restore all options on page from storage
   */
  async restoreOptions(): Promise<void> {
    this.haltChangeListeners();

    const stg = await getOptions('local', [
      'auto_link',
      'auto_link_rewrite',
      'autolink_exclusions',
      'context_menu',
      'context_menu_match',
      'cr_autolink',
      'cr_bubble',
      'cr_context',
      'cr_history',
      'cr_omnibox',
      'custom_resolver',
      'doi_resolver',
      'history',
      'history_fetch_title',
      'history_length',
      'history_showsave',
      'history_showtitles',
      'history_sortby',
      'meta_buttons',
      'omnibox_tab',
      'shortdoi_resolver',
      'sync_data',
      'theme',
    ]);

    const defaultOptions = getDefaultOptions();
    this.elements_.doiResolverInput.value = stg.doi_resolver ?? defaultOptions.doi_resolver;
    this.elements_.shortDoiResolverInput.value =
      stg.shortdoi_resolver ?? defaultOptions.shortdoi_resolver;
    this.elements_.history.checked = stg.history ?? defaultOptions.history;
    this.elements_.historyNotice.hidden = stg.history ?? defaultOptions.history;
    this.elements_.historyShowSave.checked =
      stg.history_showsave ?? defaultOptions.history_showsave;
    this.elements_.historyShowTitles.checked =
      stg.history_showtitles ?? defaultOptions.history_showtitles;
    this.elements_.historySortBy.value = stg.history_sortby ?? defaultOptions.history_sortby;
    this.elements_.historyLength.value = `${stg.history_length ?? defaultOptions.history_length}`;
    this.elements_.historyFetchTitle.checked =
      stg.history_fetch_title ?? defaultOptions.history_fetch_title;
    this.elements_.context.checked = stg.context_menu ?? defaultOptions.context_menu;
    this.elements_.contextMatch.checked =
      stg.context_menu_match ?? defaultOptions.context_menu_match;
    this.elements_.meta.checked = stg.meta_buttons ?? defaultOptions.meta_buttons;
    this.elements_.customResolver.checked = stg.custom_resolver ?? defaultOptions.custom_resolver;
    this.elements_.syncData.checked = stg.sync_data ?? defaultOptions.sync_data;
    this.elements_.crAutolink.value = stg.cr_autolink ?? defaultOptions.cr_autolink;
    this.elements_.crBubble.value = stg.cr_bubble ?? defaultOptions.cr_bubble;
    this.elements_.crContext.value = stg.cr_context ?? defaultOptions.cr_context;
    this.elements_.crHistory.value = stg.cr_history ?? defaultOptions.cr_history;
    this.elements_.crOmnibox.value = stg.cr_omnibox ?? defaultOptions.cr_omnibox;
    this.elements_.omniboxOpento.value = stg.omnibox_tab ?? defaultOptions.omnibox_tab;
    this.elements_.autolink.checked = stg.auto_link ?? defaultOptions.auto_link;
    this.elements_.autolinkRewrite.checked =
      stg.auto_link_rewrite ?? defaultOptions.auto_link_rewrite;
    this.elements_.autolinkExclusions.value = (
      stg.autolink_exclusions ?? defaultOptions.autolink_exclusions
    ).join('\n');
    this.elements_.theme.value = stg.theme ?? defaultOptions.theme;

    this.optionsDisplayUpdates();
    this.startChangeListeners();
    this.storageListener(true);
  }

  /**
   * Update display based on option states
   */
  optionsDisplayUpdates() {
    if (isDisplayTheme(this.elements_.theme.value)) {
      // No need to await here. This can happen async.
      applyTheme(window, this.elements_.theme.value).catch((error) => {
        logError('Failed to refresh theme', error);
      });
    }

    this.elements_.historySubOptions.hidden = !this.elements_.history.checked;
    this.elements_.contextSubOptions.hidden = !this.elements_.context.checked;

    const customResolver = this.elements_.customResolver.checked;
    if (customResolver) {
      this.setCrPreviews();
    }
    this.elements_.customResolverSubOptions.hidden = !customResolver;

    const historyEnabled = this.elements_.history.checked;
    this.elements_.historyNotice.hidden = this.elements_.history.checked;
    this.elements_.historyImportInput.disabled = !historyEnabled;
    this.elements_.historyImportInput.placeholder = historyEnabled
      ? ''
      : chrome.i18n.getMessage('historyNoticeText');
    this.elements_.historyImportSubmit.disabled = !historyEnabled;

    const autolink = this.elements_.autolink.checked;
    this.elements_.autolinkSubOptions.hidden = !autolink;
    const crAutolink = this.elements_.crAutolink.value;
    const showAlRewriteLinks = autolink && customResolver && crAutolink === 'custom';
    this.elements_.alExclusions.hidden = !this.elements_.autolink.checked;
    this.elements_.alRewriteLinks.hidden = !showAlRewriteLinks;
  }

  /**
   * Set a flag indicating the storage listener status
   * @param enable Status of storage listener
   */
  storageListener(enable: boolean) {
    this.storageListenerStatus_ = enable;
  }

  /**
   * Handle settings updated runtime message
   * @param updatedOptions Updated options
   * @param forceUpdate Whether to force a page update
   */
  async handleSettingsUpdate(updatedOptions: StorageOptions, forceUpdate: boolean): Promise<void> {
    if (!this.storageListenerStatus_ && !forceUpdate) {
      this.storageListener(true);
      return;
    }

    // Debugging
    // logInfo('Storage changed, checking for updates');

    if (Object.keys(updatedOptions).length === 0) {
      // Debugging
      // logInfo('Nothing to update');
      return;
    }

    if (updatedOptions.autolink_exclusions !== undefined) {
      await this.outputAutolinkExclusionTestResults();
    }

    const allOptionsInPage: (keyof StorageOptions)[] = [
      'auto_link_rewrite',
      'autolink_exclusions',
      'context_menu',
      'cr_autolink',
      'cr_bubble',
      'cr_context',
      'cr_history',
      'cr_omnibox',
      'custom_resolver',
      'doi_resolver',
      'history',
      'history_fetch_title',
      'history_length',
      'history_showsave',
      'history_showtitles',
      'history_sortby',
      'meta_buttons',
      'omnibox_tab',
      'shortdoi_resolver',
      'sync_data',
      'theme',
    ];

    const historyRefreshOptions: (keyof StorageOptions)[] = [
      'cr_history',
      'custom_resolver',
      'doi_resolver',
      'history_sortby',
      'recorded_dois',
      'shortdoi_resolver',
    ];

    const optionsUpdated = allOptionsInPage.some((option) => updatedOptions[option] !== undefined);
    const historyUpdated = historyRefreshOptions.some(
      (option) => updatedOptions[option] !== undefined
    );

    if (optionsUpdated) {
      logInfo('Options updated');
      await this.restoreOptions();
    }
    if (historyUpdated) {
      logInfo('History updated');
      await this.populateHistory();
    }
    if (!optionsUpdated && !historyUpdated) {
      logInfo('No relevant updates found');
    }

    this.storageListener(true);
  }

  /**
   * Set context menu resolver previews
   */
  setCrPreviews() {
    const drInput = this.elements_.doiResolverInput.value;
    const srInput = this.elements_.shortDoiResolverInput.value;
    let drPreview = '';
    let srPreview = '';

    if (drInput.length <= 10) {
      drPreview = drInput + '10.1000/182';
    } else {
      drPreview = '&hellip;' + drInput.slice(-10, drInput.length) + '10.1000/182';
    }
    if (srInput.length <= 10) {
      srPreview = srInput + 'dws9sz';
    } else {
      srPreview = '&hellip;' + srInput.slice(-10, srInput.length) + 'dws9sz';
    }

    this.elements_.doiResolverOutput.innerHTML = drPreview;
    this.elements_.shortDoiResolverOutput.innerHTML = srPreview;
  }

  /**
   * Display test result for autolink exclusions
   */
  async outputAutolinkExclusionTestResults(): Promise<void> {
    const autolinkTestExclusionResult = this.elements_.autolinkTestExclusionResult;

    autolinkTestExclusionResult.classList.remove('match', 'nomatch');

    const testUrl = this.elements_.autolinkTestExclusion.value;
    if (!testUrl) {
      autolinkTestExclusionResult.innerHTML = '';
      return;
    }
    if (!/https?:\/\//i.test(testUrl)) {
      autolinkTestExclusionResult.innerHTML = chrome.i18n.getMessage(
        'autolinkExclusionsInvalidUrl'
      );
      return;
    }

    const exclusions = this.elements_.autolinkExclusions.value.split('\n').filter(Boolean);
    const matched = await testAutolinkExclusion(testUrl, exclusions);

    if (matched) {
      autolinkTestExclusionResult.innerHTML = chrome.i18n.getMessage('autolinkExclusionsMatch');
      autolinkTestExclusionResult.classList.add('match');
    } else {
      autolinkTestExclusionResult.innerHTML = chrome.i18n.getMessage('autolinkExclusionsNoMatch');
      autolinkTestExclusionResult.classList.add('nomatch');
    }
  }

  /**
   * Initiate permissions request/removal to set autolink option.
   */
  // handleSettingsUpdate ignores the auto_link setting in storage, so it's safe
  // to update it without worry of triggering the change handler. The checkbox
  // change handler does need to be disabled, though, as we may end up
  // programmatically setting the check state if permissions are not accepted.
  async setAutolink(): Promise<void> {
    const autolinkElm = this.elements_.autolink;
    this.haltChangeListeners();

    if (autolinkElm.checked) {
      const granted = await requestContentScriptPermissions();
      if (granted) {
        logInfo('Autolink enabled');
        await setOptions('local', {auto_link: true});
        this.optionsDisplayUpdates();
      } else {
        logInfo('Content script permissions not granted');
        await setOptions('local', {auto_link: false});
        autolinkElm.checked = false;
      }
    } else {
      const stg = await getOptions('local', ['context_menu_match']);
      if (stg.context_menu_match) {
        logInfo('Autolink disabled');
        await setOptions('local', {auto_link: false});
        this.optionsDisplayUpdates();
      } else {
        const removed = await removeContentScriptPermissions();
        if (removed) {
          logInfo('Content script permissions removed');
          await setOptions('local', {auto_link: false});
          this.optionsDisplayUpdates();
        } else {
          logInfo('Content script permissions could not be removed');
          logInfo('Autolink disabled');
          await setOptions('local', {auto_link: false});
          this.optionsDisplayUpdates();
        }
      }
    }

    this.startChangeListeners();
  }

  /**
   * Set context menu option
   */
  async setContextMenu(): Promise<void> {
    const contextMenuElm = this.elements_.context;
    if (!contextMenuElm.checked) {
      await setOptions('local', {context_menu_match: false});
      this.haltChangeListeners();
      const contextMatchElm = this.elements_.contextMatch;
      contextMatchElm.checked = false;
      this.startChangeListeners();
    }

    await this.saveOptions();
  }

  /**
   * Initiate permissions request/removal to set context menu match option.
   */
  // handleSettingsUpdate ignores the context_menu_match setting in storage, so
  // it's safe to update it without worry of triggering the change handler. The
  // checkbox change handler does need to be disabled, though, as we may end up
  // programmatically setting the check
  // state if permissions are not accepted.
  async setContextMenuMatch(): Promise<void> {
    const contextMatchElm = this.elements_.contextMatch;
    this.haltChangeListeners();

    if (contextMatchElm.checked) {
      const granted = await requestContentScriptPermissions();
      if (granted) {
        logInfo('Context menu match enabled');
        updateContextMenu(ContextMenuId.ResolveDoi, false);
        await setOptions('local', {context_menu_match: true});
      } else {
        logInfo('Content script permissions not granted');
        await setOptions('local', {context_menu_match: false});
        contextMatchElm.checked = false;
      }
    } else {
      const stg = await getOptions('local', ['auto_link', 'context_menu']);
      if (stg.auto_link) {
        logInfo('Context menu match disabled');
        await setOptions('local', {context_menu_match: false});
        updateContextMenu(ContextMenuId.ResolveDoi, !!stg.context_menu);
      } else {
        const removed = await removeContentScriptPermissions();
        if (removed) {
          logInfo('Content script permissions removed');
          await setOptions('local', {context_menu_match: false});
          updateContextMenu(ContextMenuId.ResolveDoi, !!stg.context_menu);
        } else {
          logInfo('Content script permissions could not be removed');
          logInfo('Context menu match disabled');
          await setOptions('local', {context_menu_match: false});
          updateContextMenu(ContextMenuId.ResolveDoi, !!stg.context_menu);
        }
      }
    }

    this.startChangeListeners();
  }

  /**
   * Get URL for a DOI to use in history display
   * @param doi DOI
   */
  getHistoryUrl(doi: string): string {
    const customResolver = this.elements_.customResolver.checked;
    const crHistory = this.elements_.crHistory.value;
    const useCustomResolver = customResolver && crHistory === 'custom';

    let doiUrl;
    if (useCustomResolver) {
      if (/^10\//.test(doi)) {
        doiUrl = this.elements_.shortDoiResolverInput.value;
        doiUrl += doi.replace(/^10\//, '');
      } else {
        doiUrl = this.elements_.doiResolverInput.value;
        doiUrl += doi;
      }
    } else {
      if (/^10\//.test(doi)) {
        doiUrl = this.defaultDoiResolver_ + doi.replace(/^10\//, '');
      } else {
        doiUrl = this.defaultDoiResolver_ + doi;
      }
    }

    return doiUrl;
  }

  /**
   * Populate the history display
   */
  async populateHistory(): Promise<void> {
    if (!this.elements_.history.checked) {
      return;
    }

    this.haltHistoryChangeListeners();

    const stg = await getOptions('local', ['recorded_dois', 'history_sortby']);
    if (!stg.recorded_dois) {
      return;
    }

    this.removeAllHistoryEntries();

    // Skip holes in the array (should not occur)
    stg.recorded_dois = stg.recorded_dois.filter(Boolean);

    sortHistoryEntries(stg.recorded_dois, stg.history_sortby);

    const historyContainer = this.elements_.historySeparator.parentNode;
    if (historyContainer instanceof HTMLElement) {
      stg.recorded_dois.forEach((recordedDoi) => {
        const historyEntry = this.generateHistoryEntry(recordedDoi);
        if (historyEntry) {
          historyContainer.appendChild(historyEntry);
        }
      });
    }

    this.startHistoryChangeListeners();
  }

  /**
   * Generate a history row
   * @param recordedDoi History record
   */
  generateHistoryEntry(recordedDoi: HistoryDoi): DocumentFragment | null {
    const template = this.elements_.history_entry_template;

    const clone = document.importNode(template.content, true);
    const history_entry = clone.querySelector<HTMLTableRowElement>('tr.history_entry');
    const history_input_save = clone.querySelector<HTMLInputElement>('input.history_input_save');
    const history_entry_link = clone.querySelector<HTMLAnchorElement>('a.history_entry_link');
    const history_entry_title = clone.querySelector<HTMLDivElement>('div.history_entry_title');

    if (!history_entry || !history_input_save || !history_entry_link || !history_entry_title) {
      return null;
    }

    history_entry.setAttribute('data-doi', recordedDoi.doi);
    history_input_save.checked = recordedDoi.save;
    history_entry_link.href = this.getHistoryUrl(recordedDoi.doi);
    history_entry_link.textContent = recordedDoi.doi;
    history_entry_title.title = chrome.i18n.getMessage('historyCopyTitle');
    history_entry_title.textContent = recordedDoi.title;

    const delta = 6;
    let startX = 0;
    let startY = 0;

    history_entry_title.addEventListener('mousedown', function (event) {
      startX = event.pageX;
      startY = event.pageY;
    });

    history_entry_title.addEventListener('mouseup', function (event) {
      if (Math.abs(event.pageX - startX) < delta && Math.abs(event.pageY - startY) < delta) {
        if (!navigator.clipboard?.writeText) {
          return;
        }

        navigator.clipboard.writeText(recordedDoi.title).catch((error) => {
          logError('Unable to write to clipboard', error);
        });
      }
    });

    // history_entry_title.addEventListener('click', function () {
    //   if (!navigator.clipboard?.writeText) {
    //     return;
    //   }

    //   navigator.clipboard.writeText(recordedDoi.title).catch((error) => {
    //     logError('Unable to write to clipboard', error);
    //   });
    // });

    return clone;
  }

  /**
   * Show/hide the history loading spinner
   * @param enable Whether to show or hide the spinner
   */
  toggleHistorySpinner(enable: boolean): void {
    if (enable) {
      this.elements_.historySpinner.classList.add('show_spinner');
    } else {
      this.elements_.historySpinner.classList.remove('show_spinner');
    }
  }

  /**
   * Look up titles for history DOIs without titles
   */
  async findMissingHistoryTitles(): Promise<void> {
    const granted = await requestMetaPermissions();
    if (!granted) {
      logInfo('Aborting new title retrieval because permissions not granted');
      return;
    }

    const stg = await getOptions('local', ['recorded_dois']);
    if (!stg.recorded_dois) {
      return;
    }

    const dois = stg.recorded_dois.filter((record) => !record.title).map((record) => record.doi);
    if (!dois.length) {
      logInfo('No DOIs are missing titles');
      return;
    }

    logInfo('DOIs queued for title fetch', dois);

    this.toggleHistorySpinner(true);

    const doiTitles = await fetchDoiTitles(dois);
    if (doiTitles) {
      await this.saveHistoryTitles(doiTitles);
    }
    this.toggleHistorySpinner(false);
  }

  /**
   * Update history title permissions
   */
  async updateHistoryTitlePermissions(): Promise<void> {
    const historyFetchTitle = this.elements_.historyFetchTitle;
    if (historyFetchTitle.checked) {
      const granted = await requestMetaPermissions();
      if (granted) {
        await this.saveOptions();
      } else {
        historyFetchTitle.checked = false;
      }
    } else {
      await this.saveOptions();
    }
  }

  /**
   * Save tiles for DOIs in history
   * @param doiTitles DOI-title reference
   */
  async saveHistoryTitles(doiTitles: Record<string, string | undefined>): Promise<void> {
    const dois = Object.keys(doiTitles);
    if (dois.length === 0) {
      return;
    }

    const stg = await getOptions('local', ['recorded_dois']);
    if (!stg.recorded_dois) {
      return;
    }

    let stgUpdated = false;
    for (const doi of dois) {
      const title = doiTitles[doi];
      if (!title) {
        continue;
      }

      const record = stg.recorded_dois.find((item) => item.doi === doi);
      if (record) {
        record.title = title;
        stgUpdated = true;
      }
    }

    if (stgUpdated) {
      await this.saveIndividualOptions(stg);
    }
  }

  /**
   * Handle save history entry
   * @param event Change event
   */
  async saveHistoryEntry(event: Event): Promise<void> {
    const save =
      event.currentTarget instanceof HTMLInputElement ? event.currentTarget.checked : undefined;
    if (save === undefined) {
      return;
    }

    let row = event.currentTarget;
    let doi = '';
    while (row instanceof HTMLElement && !doi) {
      doi = row.getAttribute('data-doi') || '';
      if (doi) {
        break;
      }
      row = row.parentNode;
    }

    if (!doi || !(row instanceof HTMLElement)) {
      return;
    }

    const stg = await getOptions('local', ['recorded_dois']);
    if (!stg.recorded_dois) {
      return;
    }

    const index = stg.recorded_dois.findIndex((item) => item.doi === doi);
    if (index < 0) {
      logError('Unable to save history entry because it is missing from storage');
    }
    stg.recorded_dois[index].save = save;
    await this.saveIndividualOptions(stg);
  }

  /**
   * Handle delete history entry
   * @param event Click event
   */
  async deleteHistoryEntry(event: Event): Promise<void> {
    let row = event.currentTarget;
    let doi = '';
    while (row instanceof HTMLElement && !doi) {
      doi = row.getAttribute('data-doi') || '';
      if (doi) {
        break;
      }
      row = row.parentNode;
    }

    if (!doi || !(row instanceof HTMLElement)) {
      return;
    }

    const stg = await getOptions('local', ['recorded_dois']);
    if (!stg.recorded_dois) {
      return;
    }

    const index = stg.recorded_dois.findIndex((item) => item.doi === doi);
    if (index < 0) {
      logError('Unable to delete history entry because it is missing from storage');
    }
    stg.recorded_dois.splice(index, 1);

    row.classList.add('fadeOut');
    setTimeout(() => {
      this.saveIndividualOptions(stg).catch((error) => {
        logError('Failed to save individual options', error);
      });
    }, 300); // 300ms matches opacity transition in css
  }

  /**
   * Update history entries max length
   */
  async updateHistoryLength(): Promise<void> {
    const historyLength = Number(this.elements_.historyLength.value);
    if (Number.isNaN(historyLength) || historyLength < 1) {
      this.elements_.historyLength.value = '1';
    } else if (historyLength > 5000) {
      this.elements_.historyLength.value = '5000';
    }

    const stg = await getOptions('local', ['recorded_dois']);
    if (!stg.recorded_dois) {
      stg.recorded_dois = [];
    }

    if (historyLength >= stg.recorded_dois.length) {
      await this.saveOptions();
    } else {
      for (let i = 0; i < stg.recorded_dois.length; i++) {
        if (!stg.recorded_dois[i].save) {
          stg.recorded_dois.splice(i--, 1);
        }
        if (historyLength >= stg.recorded_dois.length) {
          break;
        }
      }
      await this.saveIndividualOptions({recorded_dois: stg.recorded_dois});
      await this.saveOptions();
    }
  }

  /**
   * Remove all history entries from display
   */
  removeAllHistoryEntries() {
    const historyEntries = document.getElementsByClassName('history_entry');
    if (historyEntries.length) {
      const parentNode = historyEntries[0].parentNode;
      if (!parentNode) {
        return;
      }

      while (historyEntries.length) {
        parentNode.removeChild(historyEntries[0]);
      }
    }
  }

  /**
   * Delete DOI history from storage
   */
  async deleteHistory(): Promise<void> {
    await this.saveIndividualOptions({recorded_dois: []});
  }

  /**
   * Record a list of DOIs into history
   */
  async importDois(): Promise<void> {
    const input = this.elements_.historyImportInput.value;
    const dois = input
      .split(/\n|,|;|\|/)
      .map((str) => str.trim())
      .filter((str) => isValidDoi(str));

    if (!dois.length) {
      this.elements_.historyImportInput.value = '';
      return;
    }

    this.toggleHistorySpinner(true);
    try {
      // Opting to use recordDois directly instead of queueRecordDois since the
      // expectation is that this options page will remain open and we want the
      // spinner to indicate that title fetch is still ongoing (if enabled).
      await recordDois(dois.map((doi) => ({doi, title: '', save: false})));
      this.elements_.historyImportInput.value = '';
    } catch (ex) {
      this.elements_.historyImportFailure.click();
    } finally {
      this.toggleHistorySpinner(false);
    }
  }

  /**
   * Get localization strings and populate their corresponding elements' HTML.
   */
  getLocalMessages() {
    const title = chrome.i18n.getMessage('optionsTitle');
    document.title = title;

    const messageIds = [
      'headingAutolink',
      'headingContextMenu',
      'headingCustomResolver',
      'headingHistory',
      'headingMeta',
      'headingOmnibox',
      'headingSync',
      'headingTheme',
      'historyClear',
      'historyFetchTitleLabel',
      'historyImport',
      'historyImportDescription',
      'historyImportModalLabel',
      'historyImportSubmit',
      'historyNoticeText',
      'historySortByDate',
      'historySortByDoi',
      'historySortByLabel',
      'historySortBySave',
      'historySortByTitle',
      'historyTitleRefresh',
      'infoModalLabel',
      'optionAutolink',
      'optionAutolinkExclusions',
      'optionAutolinkRewrite',
      'optionAutolinkTestExclusion',
      'optionContextMatch',
      'optionContextMenu',
      'optionCrAutolink',
      'optionCrBubble',
      'optionCrContext',
      'optionCrHistory',
      'optionCrOmnibox',
      'optionCustomResolver',
      'optionCustomResolverSelection',
      'optionHistory',
      'optionHistoryLength',
      'optionHistoryShowSave',
      'optionHistoryShowTitles',
      'optionMetaButtons',
      'optionOmniboxOpento',
      'optionOmniboxOpentoCurtab',
      'optionOmniboxOpentoNewBacktab',
      'optionOmniboxOpentoNewForetab',
      'optionSyncData',
      'optionTheme',
      'optionThemeDark',
      'optionThemeLight',
      'optionThemeSystem',
      'syncDataWipeButton',
      'syncDataWipeDescription',
      'tableHeadingDelete',
      'tableHeadingDoi',
      'tableHeadingSave',
      'textDoiResolverInput',
      'textShortDoiResolverInput',
    ];

    messageIds.forEach((messageId) => {
      const message = chrome.i18n.getMessage(messageId);
      const element = document.getElementById(messageId);
      if (!element) {
        logInfo(`Message for #${messageId} not inserted because element not found.`);
        return;
      }
      element.innerHTML = message;
    });

    const messageClasses = ['optionCrCustom', 'optionCrDefault', 'optionCrSelectable'];

    messageClasses.forEach((messageClass) => {
      const message = chrome.i18n.getMessage(messageClass);
      Array.from(document.getElementsByClassName(messageClass)).forEach((element) => {
        element.innerHTML = message;
      });
    });

    const doiResetMessage = chrome.i18n.getMessage('resetButton');
    this.elements_.doiResolverInputReset.innerHTML = doiResetMessage;
    this.elements_.shortDoiResolverInputReset.innerHTML = doiResetMessage;
    const urlExampleMessage = chrome.i18n.getMessage('doiOutputUrlExample');
    this.elements_.doiOutputUrlExample.innerHTML = urlExampleMessage;
    this.elements_.shortDoiOutputUrlExample.innerHTML = urlExampleMessage;

    let icon: HTMLElement | null;
    icon = document.querySelector('#icon-copy title');
    if (icon) {
      icon.innerHTML = chrome.i18n.getMessage('svgIconCopy');
    }
    icon = document.querySelector('#icon-history title');
    if (icon) {
      icon.innerHTML = chrome.i18n.getMessage('svgIconHistory');
    }
    icon = document.querySelector('#icon-cog title');
    if (icon) {
      icon.innerHTML = chrome.i18n.getMessage('svgIconCog');
    }
    icon = document.querySelector('#icon-info title');
    if (icon) {
      icon.innerHTML = chrome.i18n.getMessage('svgIconInfo');
    }

    this.elements_.extensionVersion.innerHTML = chrome.runtime.getManifest().version;
  }

  /**
   * Add link to relevant web store
   */
  private initWebStoreLink(): void {
    const webStoreLink = document.querySelector<HTMLSpanElement>('#webStoreLink');
    if (webStoreLink) {
      let url;
      let text;
      const extensionId = chrome.runtime.id;
      if (extensionId === 'goanbaknlbojfglcepjnankoobfakbpg') {
        url = 'https://chrome.google.com/webstore/detail/quickip/goanbaknlbojfglcepjnankoobfakbpg';
        text = 'Chrome Web Store';
      } else if (extensionId === 'blinbkglegdjgkpblpbgiemkbmkflgah') {
        url =
          'https://microsoftedge.microsoft.com/addons/detail/doi-resolver/blinbkglegdjgkpblpbgiemkbmkflgah';
        text = 'Edge Add-ons';
      } else if (extensionId === '{7befad41-6117-42d0-a803-4fbae41bde5a}') {
        url = `https://addons.mozilla.org/firefox/addon/{7befad41-6117-42d0-a803-4fbae41bde5a}/`;
        text = 'Firefox Add-ons';
      }

      if (url && text) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.textContent = text;
        webStoreLink.textContent = ' / ';
        webStoreLink.appendChild(anchor);
      }
    }
  }
}

/**
 * Froala enhancements
 *
 * This file adds safe pasting, full keyboard access, screen reader names and clear upload messages
 * to every Froala editor on the page. Install it once, before you create an editor.
 *
 *   import FroalaEditor from 'froala-editor';
 *   import { installFroalaEnhancements } from './froala-enhancements';
 *
 *   installFroalaEnhancements(FroalaEditor);
 *
 * Each enhancement is one small function with a name. To leave one out, pass its name.
 *
 *   installFroalaEnhancements(FroalaEditor, { skip: ['uploadChecks'] });
 *
 * The enhancements run as a Froala plugin called "enhancements". If your settings list pluginsEnabled,
 * add "enhancements" to that list.
 */

export type Enhancement =
  | 'safePaste'
  | 'shortcuts'
  | 'toolbarLabels'
  | 'dropdownNames'
  | 'keyboardToolbar'
  | 'popupEscape'
  | 'editingAreaName'
  | 'popupPosition'
  | 'uploadChecks'
  | 'cleanRestart'
  | 'ariaMarkup'
  | 'windowEscape'
  | 'scrollHints';

export interface EnhancementOptions {
  /** Enhancements to leave out. */
  skip?: Enhancement[];
  /** The name screen readers announce for the toolbar. */
  toolbarName?: string;
  /** The name screen readers announce for the text area. */
  editorName?: string;
}

/** The parts of a Froala editor instance that this file uses. */
interface Editor {
  id: number;
  el: HTMLElement;
  $: (element: Element) => unknown;
  $tb?: ArrayLike<HTMLElement> & { find: (selector: string) => unknown };
  $box?: ArrayLike<HTMLElement>;
  $wp?: ArrayLike<HTMLElement>;
  opts: { imageAllowedTypes: string[]; imageMaxSize: number; imageUploadURL?: string | null };
  shared?: { $f_el?: ArrayLike<Element> };
  accessibility: {
    focusToolbarElement: (element: unknown) => void;
    focusPopupButton: (popup: unknown) => void;
  };
  button: { exec: (button: unknown) => void; refresh: (button: unknown) => void };
  commands: { exec: (command: string, values: unknown[]) => void };
  events: {
    on: (name: string, handler: (...args: never[]) => unknown, first?: boolean) => void;
    disableBlur: () => void;
    enableBlur: () => void;
  };
  popups: { isVisible: (id: string) => boolean; get: (id: string) => ArrayLike<HTMLElement> };
  toast?: { show: (message: { description: string; type: string; position: string }) => void };
}

/** The part of the FroalaEditor class that this file uses. */
interface FroalaEditorClass {
  PLUGINS: Record<string, unknown>;
}

const watchers: { selector: string; apply: (element: HTMLElement) => void }[] = [];
let observer: MutationObserver | undefined;
let pageStarted = false;

/** Runs apply on every element that matches, now and whenever Froala adds one, because popups are built when they first open. */
function watch(selector: string, apply: (element: HTMLElement) => void): void {
  watchers.push({ selector, apply });
  document.querySelectorAll<HTMLElement>(selector).forEach(apply);
  if (observer) return;
  observer = new MutationObserver((changes) => {
    for (const change of changes) {
      change.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!node.closest('[class*="fr-"]') && !node.querySelector('[class*="fr-"]')) return;
        for (const watcher of watchers) {
          if (node.matches(watcher.selector)) watcher.apply(node);
          node.querySelectorAll<HTMLElement>(watcher.selector).forEach(watcher.apply);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Clipboard text that could run code. Everything else goes to the editor unchanged. */
const RISKY_HTML = /<script|\bon[a-z]+\s*=|javascript:/i;

function cleanHtml(html: unknown): string | undefined {
  if (typeof html !== 'string' || !RISKY_HTML.test(html)) return undefined;
  // DOMParser builds an inert document, so nothing in the HTML loads or runs while it is read.
  const page = new DOMParser().parseFromString(html, 'text/html');
  page.querySelectorAll('script').forEach((element) => element.remove());
  page.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || /^\s*javascript:/i.test(attribute.value))
        element.removeAttribute(attribute.name);
    }
  });
  return page.body.innerHTML;
}

/** Removes scripts and event handlers from pasted and dropped HTML before the editor reads it. */
function safePaste(editor: Editor): void {
  editor.events.on('paste.beforeCleanup', cleanHtml, true);
  editor.events.on('drop.beforeCleanup', cleanHtml, true);
}

/** Runs the help and quote shortcuts through the command API, with the editor they need. */
function shortcuts(editor: Editor): void {
  editor.events.on('shortcut', (_event: Event, command: string, value?: string) => {
    if (command !== 'help' && command !== 'quote') return undefined;
    editor.commands.exec(command, value ? [value] : []);
    return false;
  });
}

/** Shows the real font, size and paragraph style in the toolbar as soon as the editor opens. */
function toolbarLabels(editor: Editor): void {
  const first = editor.el.querySelector('p') ?? editor.el.firstElementChild;
  const selection = document.getSelection();
  if (!first || !selection || !editor.$tb) return;
  const focused = document.activeElement;
  const range = document.createRange();
  range.setStart(first, 0);
  selection.removeAllRanges();
  selection.addRange(range);
  for (const command of ['paragraphFormat', 'fontFamily', 'fontSize'])
    editor.button.refresh(editor.$tb.find(`[data-cmd="${command}"]`));
  selection.removeAllRanges();
  // The range can pull focus into the text, so focus goes back to where it was.
  if (document.activeElement !== focused && editor.el.contains(document.activeElement)) {
    editor.events.disableBlur();
    if (focused instanceof HTMLElement && focused !== document.body) focused.focus({ preventScroll: true });
    else editor.el.blur();
    editor.events.enableBlur();
  }
}

/** Gives a dropdown that shows a value the name "Font Family, Arial", so screen readers announce the value too. */
function nameDropdown(button: HTMLElement): void {
  const value = button.querySelector(':scope > span');
  const base = button.getAttribute('title') ?? button.getAttribute('aria-label') ?? '';
  if (!value || !base || button.dataset['named']) return;
  button.dataset['named'] = 'true';
  const update = () => {
    const shown = value.textContent?.trim();
    button.setAttribute('aria-label', shown && shown !== base ? `${base}, ${shown}` : base);
  };
  new MutationObserver(update).observe(value, { childList: true, characterData: true, subtree: true });
  update();
}

function dropdownNames(editor: Editor): void {
  const toolbar = editor.$tb?.[0];
  if (!toolbar) return;
  toolbar.querySelectorAll<HTMLElement>('.fr-btn.fr-dropdown').forEach(nameDropdown);
  // The align list marks the current alignment only when its values have no spaces around them.
  toolbar.querySelectorAll('.fr-dropdown-menu .fr-command[data-param1]').forEach((item) => {
    const value = item.getAttribute('data-param1') ?? '';
    if (value !== value.trim()) item.setAttribute('data-param1', value.trim());
  });
}

/** Makes the toolbar one Tab stop with a name. Arrow keys move inside it, Home and End jump, and Tab moves on. */
function keyboardToolbar(editor: Editor, name: string): void {
  const toolbar = editor.$tb?.[0];
  if (!toolbar) return;
  const buttonOf = (target: EventTarget | null): HTMLElement | null => {
    const button = target instanceof Element ? target.closest<HTMLElement>('.fr-command.fr-btn') : null;
    return button && !button.closest('.fr-dropdown-menu') ? button : null;
  };
  const visibleButtons = () =>
    [...toolbar.querySelectorAll<HTMLElement>('.fr-command.fr-btn')].filter(
      (button) => button.offsetWidth > 0 && !button.closest('.fr-dropdown-menu')
    );
  const enabledButtons = () => visibleButtons().filter((button) => !button.classList.contains('fr-disabled'));

  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', name);

  let tabStop: HTMLElement | null = null;
  const moveTabStop = (button?: HTMLElement) => {
    if (!button || button === tabStop) return;
    if (tabStop) tabStop.tabIndex = -1;
    tabStop = button;
    button.tabIndex = 0;
  };
  // Buttons turn on and off as the text changes and hide as the window narrows, so the Tab stop stays on one that works.
  const keepTabStop = () => {
    const unusable =
      !tabStop ||
      tabStop.offsetWidth === 0 ||
      (tabStop.classList.contains('fr-disabled') && document.activeElement !== tabStop);
    if (unusable) moveTabStop(enabledButtons()[0] ?? visibleButtons()[0]);
  };

  toolbar.addEventListener('focusin', (event) => {
    const button = buttonOf(event.target);
    if (!button) return;
    moveTabStop(button);
    // Enter and the arrow keys act on the button the editor last focused, so a button reached with Tab is handed over.
    const current = editor.shared?.$f_el?.[0];
    if (button.matches(':focus-visible') && current !== button)
      editor.accessibility.focusToolbarElement(editor.$(button));
  });
  toolbar.addEventListener(
    'keydown',
    (event) => {
      if (!buttonOf(event.target)) return;
      if (event.key === 'Tab') {
        event.stopPropagation();
        return;
      }
      if (
        (event.key === 'Home' || event.key === 'End') &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const buttons = enabledButtons();
        const next = event.key === 'Home' ? buttons[0] : buttons[buttons.length - 1];
        if (!next) return;
        event.preventDefault();
        event.stopPropagation();
        next.focus();
      }
    },
    true
  );
  new MutationObserver(keepTabStop).observe(toolbar, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
  new ResizeObserver(keepTabStop).observe(toolbar);
  keepTabStop();
}

/** Esc on a popup's buttons presses Back and returns focus to the toolbar button that opened the popup. */
function popupEscape(editor: Editor): void {
  const gone = new AbortController();
  editor.events.on('destroy', () => gone.abort());
  addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const popup = target?.closest('.fr-popup .fr-buttons')?.closest('.fr-popup');
      if (!popup || !popup.hasAttribute(`data-inst${editor.id}`)) return;
      const back = [...popup.querySelectorAll<HTMLElement>('.fr-back')].find(
        (button) => button.offsetWidth > 0
      );
      if (!back) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      editor.button.exec(editor.$(back));
      editor.accessibility.focusPopupButton(editor.$(popup));
    },
    { capture: true, signal: gone.signal }
  );
}

/** Names the text area as a multi-line text box, and names the box around it. */
function editingAreaName(editor: Editor, name: string): void {
  editor.el.setAttribute('role', 'textbox');
  editor.el.setAttribute('aria-multiline', 'true');
  editor.el.setAttribute('aria-label', name);
  const box = editor.$box?.[0];
  if (box?.getAttribute('role') === 'application') box.setAttribute('aria-label', 'Rich text editor');
}

/** Keeps Table properties and Cell properties next to their table while the text scrolls. */
function popupPosition(editor: Editor): void {
  const wrapper = editor.$wp?.[0];
  if (!wrapper) return;
  const placed = new Map<string, { scroll: number; top: number | null }>();
  const popups = ['table.tableProperties', 'table.cellProperties'];
  for (const id of popups)
    editor.events.on(`popups.show.${id}`, () => placed.set(id, { scroll: wrapper.scrollTop, top: null }));
  wrapper.addEventListener(
    'scroll',
    () => {
      for (const id of popups) {
        const position = placed.get(id);
        if (!position || !editor.popups.isVisible(id)) continue;
        const popup = editor.popups.get(id)[0];
        const top = parseFloat(popup.style.top || getComputedStyle(popup).top);
        const moved = wrapper.scrollTop - position.scroll;
        position.scroll = wrapper.scrollTop;
        if (position.top !== null && Math.abs(top - position.top) > 0.5) {
          position.top = top;
          continue;
        }
        position.top = top - moved;
        if (moved) popup.style.top = `${position.top}px`;
      }
    },
    { passive: true }
  );
}

/** Says why a picked image cannot be used, when no upload URL is set and the file stays in the browser. */
function uploadChecks(editor: Editor): void {
  editor.events.on('image.beforeUpload', (files: FileList) => {
    const file = files?.[0];
    if (!file || editor.opts.imageUploadURL) return undefined;
    const name = file.name || 'This file';
    const type = file.type ? file.type.replace('image/', '') : (name.split('.').pop() ?? '').toLowerCase();
    const allowed = editor.opts.imageAllowedTypes;
    const maxBytes = editor.opts.imageMaxSize;
    let message = '';
    if (!file.size) message = `${name} is empty. Choose another file.`;
    else if (!allowed.includes(type))
      message = `${name} is not an image this editor accepts. Choose one of these types: ${allowed.join(', ')}.`;
    else if (maxBytes && file.size > maxBytes)
      message = `${name} is ${(file.size / 1048576).toFixed(1)} MB. Choose a file under ${(maxBytes / 1048576).toFixed(1)} MB.`;
    if (!message) return undefined;
    editor.toast?.show({ description: message, type: 'error', position: 'ct-tp' });
    return false;
  });
}

/** Removes the selection handles when an editor closes, so they never become part of the text if it starts again on the same element. */
function cleanRestart(editor: Editor): void {
  editor.events.on(
    'destroy',
    () => {
      editor.$box?.[0]
        ?.querySelectorAll(':scope > .fr-selection-handle')
        .forEach((handle) => handle.remove());
    },
    true
  );
}

let windowCount = 0;

/** Gives Froala's popups, windows and dropdowns the roles and names that screen readers expect. */
function ariaMarkup(): void {
  const listRoles = /^(presentation|none|group|separator|listbox|option|menu|menuitem)$/;
  watch(':is(.fr-popup, .fr-modal) [tabindex]', (element) => {
    if (element.tabIndex > 0) element.tabIndex = 0;
  });
  watch('.fr-dropdown-menu :is(ul, li)[role]', (element) => {
    if (!listRoles.test(element.getAttribute('role') ?? '')) element.setAttribute('role', 'presentation');
  });
  watch('.fr-color-set', (set) => {
    set.setAttribute('role', 'listbox');
    set.setAttribute(
      'aria-label',
      set.classList.contains('fr-background-color') ? 'Background color' : 'Text color'
    );
    set
      .querySelectorAll(':scope > .fr-select-color')
      .forEach((color) => color.setAttribute('role', 'option'));
  });
  watch('.fr-checkbox-line', (line) => {
    const input = line.querySelector('input');
    const label = line.querySelector('label[id]');
    if (input && label && !input.labels?.length && !input.hasAttribute('aria-labelledby'))
      input.setAttribute('aria-labelledby', label.id);
  });
  watch(':is(.fr-popup, .fr-modal) input[type="file"]', (element) => {
    const input = element as HTMLInputElement;
    if (input.getAttribute('role') === 'button') input.removeAttribute('role');
    if (!input.labels?.length && !input.hasAttribute('aria-labelledby') && !input.hasAttribute('aria-label'))
      input.setAttribute('aria-label', 'Choose a file to upload');
  });
  watch('.fr-ai-assist-submit-btn', (button) => {
    if (!button.textContent?.trim() && !button.getAttribute('aria-label'))
      button.setAttribute('aria-label', 'Send');
  });
  // The arrow of a split button names its menu, so screen readers do not read the same name twice.
  watch('.fr-toolbar .fr-btn.fr-options', (arrow) => {
    const name = (arrow.getAttribute('aria-label') ?? arrow.title ?? '').trim();
    if (!name || name.endsWith(' menu')) return;
    arrow.setAttribute('aria-label', `${name} menu`);
    arrow.title = `${name} menu`;
  });
  watch('.fr-tooltip', (tooltip) => tooltip.setAttribute('aria-hidden', 'true'));
  watch('.fr-modal', (dialog) => {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title =
      dialog.querySelector('.fr-modal-head h4') ??
      dialog.querySelector('.fr-modal-head-line span, .fr-modal-head-line');
    if (title) {
      windowCount += 1;
      title.id ||= `fr-modal-title-${windowCount}`;
      dialog.setAttribute('aria-labelledby', title.id);
      if (title.matches('h4')) title.setAttribute('aria-level', '2');
    }
    const body = dialog.querySelector<HTMLElement>('.fr-modal-body');
    if (body) {
      new ResizeObserver(() => {
        if (body.scrollHeight > body.clientHeight + 1) body.tabIndex = 0;
      }).observe(body);
    }
  });
}

/** Esc closes any open Froala window, as it closes every other window. */
function windowEscape(): void {
  addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      const open = [...document.querySelectorAll<HTMLElement>('.fr-modal')].find(
        (dialog) => dialog.offsetWidth > 0 && getComputedStyle(dialog).display !== 'none'
      );
      const close = open?.querySelector<HTMLElement>('.fr-modal-close');
      if (!close || close.offsetWidth === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.click();
    },
    { capture: true }
  );
}

/** Hides tooltips and the line breaker as soon as anything scrolls, so they never sit over other text. */
function scrollHints(): void {
  addEventListener(
    'scroll',
    () => {
      document
        .querySelectorAll('.fr-line-breaker.fr-visible, .fr-tooltip.fr-visible')
        .forEach((hint) => hint.classList.remove('fr-visible'));
    },
    { capture: true, passive: true }
  );
}

/** Adds the enhancements to every editor created after this call. Calling it again changes nothing. */
export function installFroalaEnhancements(
  FroalaEditor: FroalaEditorClass,
  options: EnhancementOptions = {}
): void {
  if (typeof document === 'undefined' || FroalaEditor.PLUGINS['enhancements']) return;
  const skipped = new Set(options.skip ?? []);
  const use = (name: Enhancement) => !skipped.has(name);
  const toolbarName = options.toolbarName ?? 'Formatting';
  const editorName = options.editorName ?? 'Text editor';

  const startPage = () => {
    if (pageStarted) return;
    pageStarted = true;
    if (use('ariaMarkup')) ariaMarkup();
    if (use('windowEscape')) windowEscape();
    if (use('scrollHints')) scrollHints();
    if (use('dropdownNames')) watch('.fr-modal .fr-btn.fr-dropdown', nameDropdown);
  };

  // Froala creates plugins with new, so this must be a regular function.
  FroalaEditor.PLUGINS['enhancements'] = function (editor: Editor) {
    return {
      _init() {
        if (use('safePaste')) safePaste(editor);
        if (use('shortcuts')) shortcuts(editor);
        if (use('uploadChecks')) uploadChecks(editor);
        if (use('popupEscape')) popupEscape(editor);
        if (use('cleanRestart')) cleanRestart(editor);
        editor.events.on('initialized', () => {
          startPage();
          if (use('toolbarLabels')) toolbarLabels(editor);
          if (use('dropdownNames')) dropdownNames(editor);
          if (use('keyboardToolbar')) keyboardToolbar(editor, toolbarName);
          if (use('editingAreaName')) editingAreaName(editor, editorName);
          if (use('popupPosition')) popupPosition(editor);
        });
      }
    };
  };
}

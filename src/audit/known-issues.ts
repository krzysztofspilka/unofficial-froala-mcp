// Known problems with Froala and their fixes. froala_audit_code returns the ones that can apply to a project.
// Each entry says which versions it affects, what shows it, how to fix it, and how the fix was checked.
// When a Froala release fixes a problem, keep the entry, and give it a fixed version in applies and affects,
// so people on older versions still get the fix.
import { FROALA_VERSION, knowledge } from '../data.js';
import { WRAPPER_FOR, froalaAtMost, isAtLeast, usesAngularSsr, wrapperImportBug, type Answer, type Project, type Target } from '../project.js';

export interface KnownIssue {
  id: string;
  title: string;
  targets: Target[] | 'all';
  affects: string;
  /**
   * 'yes' when package.json shows the problem affects the project, 'unknown' when it depends on the
   * project's code (or on versions package.json does not show), 'no' when it does not apply.
   */
  applies: (p: Project) => Answer;
  /** Code that uses the feature. When files are sent and none of them match, the issue is left out. */
  codeMatch?: RegExp;
  /** The froala-enhancements function that fixes this. Projects that install that file do not need the entry. */
  enhancement?: string;
  problem: string;
  fix: string;
  tested: string;
}

const usesReactWrapper = (p: Project) => p.target === 'react' || p.target === 'nextjs';
const usesVueWrapper = (p: Project) => p.target === 'vue' || p.target === 'nuxt';
/** Applies to these targets on the release this server covers or older, but only if the code does what the problem describes. */
const dependsOnCode = (matches: boolean, version: Answer): Answer => (!matches || version === 'no' ? 'no' : 'unknown');
const when = (condition: boolean): Answer => (condition ? 'yes' : 'no');
const core = (p: Project) => froalaAtMost(p, 'froala-editor', FROALA_VERSION);
/** Depends on the project's code, for every target, on the release this server covers or older. */
const inCode = (p: Project) => dependsOnCode(true, core(p));

/** Froala 5.5.0 or older. A wrapper fixes the froala-editor version, so it answers when froala-editor is not listed. */
const onOlderLicensing = (p: Project) => {
  const wrapper = p.target && WRAPPER_FOR[p.target];
  return froalaAtMost(p, !p.has('froala-editor') && wrapper && p.has(wrapper) ? wrapper : 'froala-editor', '5.5.0');
};

const enhancementFix = (name: string) =>
  `The froala-enhancements file from froala_get_setup does this. The enhancement is called ${name}. Call installFroalaEnhancements(FroalaEditor) before you create an editor.`;
const CHECKED = 'Tested in Chrome with Froala 5.5.0, with and without the enhancement (4 Nov 2026).';
const SEEN = 'Seen in Chrome with Froala 5.5.0 (October 2026).';
const READ = 'Read in the Froala 5.5.0 package (October 2026).';
const DEMO = 'This code runs on the Froala Demo page, where a browser test covers it (October 2026).';

const snippet = (name: string, language = 'js') => `\`\`\`${language}\n${knowledge.snippets[name]}\n\`\`\``;

export const KNOWN_ISSUES: KnownIssue[] = [
  {
    id: 'unlicensed-banner',
    title: 'A red unlicensed banner blocks most toolbar buttons',
    targets: 'all',
    affects: 'froala-editor 5.5.0 or older on a hosted site without a key',
    applies: (p) => dependsOnCode(true, onOlderLicensing(p)),
    problem: 'Without a valid key, a hosted site shows a red banner and only bold, italic and underline work.',
    fix: 'Upgrade to Froala 5.6.0 or newer, where every feature works with any key and the editor shows a small notice. A commercial key stays as it is, even if it has expired.',
    tested: 'Tested with Froala 5.5.0 in Chrome (12 Oct 2026). The 5.6.0 behaviour comes from its release notes.'
  },
  {
    id: 'licence-notice',
    title: 'The editor shows a licence notice',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or newer without a valid commercial key',
    applies: (p) => (onOlderLicensing(p) === 'yes' ? 'no' : 'unknown'),
    problem: 'A small notice next to "Powered by Froala", and the same text in the console, says that the key is missing, invalid or expired, or that this is a trial. Localhost shows it too.',
    fix: 'This is expected, and every feature keeps working. With no key, use the public trial key. With an expired commercial key, keep the key and renew it. Never replace it with the trial key. The editor checks that the notice stays visible, so do not hide it with CSS. Call froala_query_docs in licensing mode for every message.',
    tested: 'From the Froala 5.6.0 release notes.'
  },
  {
    id: 'angular-commonjs-warning',
    title: 'ng build warns that Froala is CommonJS',
    targets: ['angular'],
    affects: 'Angular projects with any Froala version',
    applies: (p) => dependsOnCode(p.target === 'angular', 'yes'),
    problem: 'ng build prints a warning that froala-editor is not an ES module and can make the bundle larger.',
    fix: 'In angular.json, add "allowedCommonJsDependencies": ["froala-editor"] to projects > (your app) > architect > build > options.',
    tested: 'Angular 22 ng build (4 Nov 2026).'
  },
  {
    id: 'pasted-html-handlers',
    title: 'Pasted HTML can run its event handlers',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older, with default settings',
    applies: core,
    enhancement: 'safePaste',
    problem:
      'While the editor cleans pasted or dropped HTML, handlers such as onerror on an image or ontoggle on a details element run in your page, although none stays in the text. A web page can put such HTML on the clipboard of anyone who copies from it.',
    fix: enhancementFix('safePaste'),
    tested: CHECKED
  },
  {
    id: 'shortcut-errors',
    title: 'The help and quote shortcuts throw an error',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the help or quote plugin',
    applies: inCode,
    codeMatch: /help\.min|quote\.min|plugins\.pkgd|\bhelp\b|\bquote\b/,
    enhancement: 'shortcuts',
    problem: 'Ctrl or Cmd with / and Ctrl or Cmd with \' throw "Cannot read properties of undefined" instead of opening the help window or making a quote.',
    fix: enhancementFix('shortcuts'),
    tested: CHECKED
  },
  {
    id: 'toolbar-placeholder-labels',
    title: 'Font and size dropdowns show placeholders after load',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with fontFamilySelection, fontSizeSelection or paragraphFormatSelection',
    applies: inCode,
    codeMatch: /fontFamilySelection|fontSizeSelection|paragraphFormatSelection/,
    enhancement: 'toolbarLabels',
    problem: 'The dropdowns read "Font Family" and "Font Size" until someone clicks in the text.',
    fix: enhancementFix('toolbarLabels'),
    tested: CHECKED
  },
  {
    id: 'dropdown-names',
    title: 'Dropdowns do not announce the value they show',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: core,
    enhancement: 'dropdownNames',
    problem: 'A screen reader hears "Font Family" and not the value on screen. The align list also stores its values with spaces around them, so it never marks the current alignment.',
    fix: enhancementFix('dropdownNames'),
    tested: CHECKED
  },
  {
    id: 'toolbar-keyboard',
    title: 'The toolbar cannot be reached with Tab',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: core,
    enhancement: 'keyboardToolbar',
    problem: 'The toolbar has no role or name, and no button is in the Tab order. Only Alt+F10 reaches it, and once inside, Tab stays in the toolbar.',
    fix: enhancementFix('keyboardToolbar'),
    tested: CHECKED
  },
  {
    id: 'editing-area-name',
    title: 'The editing area has no role or name',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: core,
    enhancement: 'editingAreaName',
    problem: 'Screen readers announce the text area as an unnamed group.',
    fix: enhancementFix('editingAreaName'),
    tested: CHECKED
  },
  {
    id: 'popup-accessibility',
    title: 'Popups and windows fail accessibility checks',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: core,
    enhancement: 'ariaMarkup',
    problem: 'axe reports positive tabindex values, unlabelled inputs, invalid roles and windows that are not dialogs.',
    fix: enhancementFix('ariaMarkup'),
    tested: 'Tested with axe-core in Chrome with Froala 5.5.0, on the link and image popups (4 Nov 2026).'
  },
  {
    id: 'popup-back-escape',
    title: 'Esc on a popup Back button throws an error',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: core,
    enhancement: 'popupEscape',
    problem: 'In a popup with a Back button, such as Insert Table, Esc throws in the accessibility module and focus drops into the text.',
    fix: enhancementFix('popupEscape'),
    tested: CHECKED
  },
  {
    id: 'image-upload-messages',
    title: 'Every failed image reads as a bad link',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older, without imageUploadURL',
    applies: core,
    enhancement: 'uploadChecks',
    problem: 'A text file, an empty file or a very large image all show "Image cannot be loaded from the passed link."',
    fix: enhancementFix('uploadChecks'),
    tested: CHECKED
  },
  {
    id: 'restart-leftovers',
    title: 'Restarting an editor adds hidden markup to the content',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older, when an editor starts again on the same element',
    applies: core,
    enhancement: 'cleanRestart',
    problem:
      'After destroy() and a new editor on the same element, html.get() returns two extra selection handle elements. Each restart adds two more. React StrictMode restarts the editor in development.',
    fix: enhancementFix('cleanRestart'),
    tested: CHECKED
  },
  {
    id: 'tooltip-stays-on-scroll',
    title: 'Tooltips stay over the text while it scrolls',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older, when the text scrolls inside the editor',
    applies: inCode,
    codeMatch: /heightMax|height\s*:/,
    enhancement: 'scrollHints',
    problem: 'With the pointer still, a tooltip stays where it was while the text moves under it.',
    fix: enhancementFix('scrollHints'),
    tested: CHECKED
  },
  {
    id: 'table-popup-position',
    title: 'Table properties stay put while the text scrolls',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the table plugin, when the text scrolls inside the editor',
    applies: inCode,
    codeMatch: /insertTable|table\.min|plugins\.pkgd/,
    enhancement: 'popupPosition',
    problem: 'Table properties and Cell properties stay where they opened, while other popups follow the text.',
    fix: enhancementFix('popupPosition'),
    tested: SEEN
  },
  {
    id: 'collaboration-undo',
    title: 'One undo after load empties the document',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the collaborative plugin',
    applies: inCode,
    codeMatch: /collabConfig|collaborative/,
    problem: 'The collaboration history counts the loaded content as an edit, so Ctrl or Cmd with Z before typing removes the whole document. Edits made within 500 ms of it go with it.',
    fix: `Keep undo off until the first key press, then clear the plugin's history. Call undoFloor(editor) in the initialized event, and call the function it returns on the first key press or click.\n\n${snippet('undoFloor')}`,
    tested: DEMO
  },
  {
    id: 'version-history-focus',
    title: 'Version history keeps focus behind it',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the collaborative plugin',
    applies: inCode,
    codeMatch: /versionControl|collabConfig/,
    problem: 'Focus stays on the button that opened Version history, Tab walks the hidden text first, and Back drops focus on the page. The filter and More menus take no keys.',
    fix: `Call historyView(editor) in the initialized event.\n\n${snippet('historyView')}`,
    tested: DEMO
  },
  {
    id: 'collaboration-panels',
    title: 'Comments and version panels need layout rules on narrow screens',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the collaborative plugin',
    applies: inCode,
    codeMatch: /collabConfig|collabPanel/,
    problem:
      'In a narrow desktop window the comments panel uses the phone layout without its list. On a phone the comments panel and version list are fixed to the window and cover other content. Version history opened before full screen keeps its first height. An open AI chat hides its rail.',
    fix: 'Keep the panels inside the editor with your own CSS on .fr-collab-panel and .fr-ai-chat-panel. Show the list when no mobile state is set, anchor the history views to the foot of .fr-box, and test at 400 pixels wide.',
    tested: SEEN
  },
  {
    id: 'version-restore',
    title: 'Restore replaces the text at once',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the collaborative plugin',
    applies: inCode,
    codeMatch: /versionControl/,
    problem: 'Restoring a version replaces the text with no question, and what it said is in no version.',
    fix: 'Ask first in your own button, and save the current text as a version before you restore.',
    tested: SEEN
  },
  {
    id: 'files-manager-print-key',
    title: 'Ctrl or Cmd with P opens the file upload',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the filesManager plugin',
    applies: inCode,
    codeMatch: /insertFiles|files_manager|plugins\.pkgd/,
    problem: 'Files Manager binds the print shortcut to its upload window.',
    fix: `Handle the key first, in the capture phase. Pass a function that says the key is yours, and your print function.\n\n${snippet('printKey')}`,
    tested: DEMO
  },
  {
    id: 'files-manager-image-popup',
    title: 'Files Manager removes Advanced Edit from the image popup',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the filesManager and imageTUI plugins',
    applies: inCode,
    codeMatch: /image_tui|imageTUI/,
    problem: 'Advanced Edit is missing when Files Manager loads after TOAST UI.',
    fix: 'Load the files_manager plugin before the image_tui plugin.',
    tested: SEEN
  },
  {
    id: 'files-manager-needs-tui',
    title: 'Files Manager asks for TOAST UI and shows broken file icons',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the filesManager plugin',
    applies: inCode,
    codeMatch: /insertFiles|files_manager/,
    problem: 'It opens with "ImageTUI plugin is not enabled. Do you want to enable?", and file icons load from a host that no longer resolves.',
    fix: 'Load the image_tui plugin and its CSS with Files Manager, and set your own file icons in CSS.',
    tested: SEEN
  },
  {
    id: 'tui-icons',
    title: 'TOAST UI icons fail when loaded from a CDN',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the imageTUI plugin',
    applies: inCode,
    codeMatch: /image_tui|imageTUI/,
    problem: 'Browsers do not draw SVG sprites from another domain, so the icons are missing or the console logs about a hundred "Unsafe attempt to load URL" errors.',
    fix: 'Host the TOAST UI icon sprites on your own domain, and point the imageTUIOptions icon paths at them.',
    tested: SEEN
  },
  {
    id: 'pdf-export-layout',
    title: 'PDF export is shifted or blank at the top',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the print plugin and html2pdf.js',
    applies: inCode,
    codeMatch: /getPDF|html2pdf/,
    problem: 'A scrolled page leaves a blank band at the top of the PDF, and the file is always called file.pdf. An SVG image with only a viewBox is drawn as a pale corner of itself.',
    fix: 'Scroll to the top before the export, and give every SVG image a width and a height.',
    tested: SEEN
  },
  {
    id: 'model-updates-on-blur',
    title: 'The first click after typing can miss a button',
    targets: ['react', 'nextjs', 'vue', 'nuxt', 'angular'],
    affects: 'The Froala wrappers, in forms with validation messages',
    applies: () => 'unknown',
    codeMatch: /model|Model/,
    problem: 'The wrappers update your data when the editor loses focus. If that removes an error message, the page moves while the button is pressed, and the click misses it.',
    fix: 'Set immediateReactModelUpdate, immediateVueModelUpdate or immediateAngularModelUpdate to true, so the data updates on every key.',
    tested: 'Tested with TanStack Form, React 19.3 and Froala 5.5.0 in Chrome (4 Nov 2026).'
  },
  {
    id: 'long-paste',
    title: 'A very long paste freezes the page',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: inCode,
    problem: 'One paragraph of 1 MB of plain text takes about 27 seconds. With the collaborative plugin, undoing a paste of 20,000 lines takes about 72 seconds.',
    fix: `Ask before a very long paste, in the paste.before event.

\`\`\`js
events: {
  'paste.before': function (event) {
    const data = event.clipboardData;
    const size = Math.max(data.getData('text/html').length, data.getData('text/plain').length);
    if (size > 250000 && !window.confirm('This is a very long text. The editor can stop responding for a while. Paste it?')) return false;
  }
}
\`\`\``,
    tested: 'Timed in Chrome with Froala 5.5.0 (October 2026).'
  },
  {
    id: 'selected-text-color',
    title: 'Selected text is always black',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: inCode,
    codeMatch: /textColor|theme\s*:\s*['"]dark/,
    problem: "Froala's stylesheet paints selected text black, so a new text color cannot be seen while selected, and text in the dark theme turns black.",
    fix: `Add this rule after Froala's CSS.

\`\`\`css
.fr-wrapper .fr-element ::selection,
.fr-wrapper .fr-element::selection {
  background: rgb(0 152 247 / 0.24);
  color: currentcolor;
}
\`\`\``,
    tested: SEEN
  },
  {
    id: 'popup-focus-ring',
    title: 'Clicking an emoji or symbol popup rings its first cell',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the emoticons or specialCharacters plugin',
    applies: inCode,
    codeMatch: /emoticons|specialCharacters/,
    problem: 'Focus moves to the first cell as the popup opens, and Chrome draws it as if a key moved there.',
    fix: `Note whether the last input was the pointer, and draw that cell plain until a key is pressed.

${snippet('pointerFocus')}

\`\`\`css
.fr-by-pointer .fr-popup .fr-icon-container .fr-command:focus-visible:not(:hover) {
  outline: 0 !important;
  background: transparent !important;
}
\`\`\``,
    tested: DEMO
  },
  {
    id: 'popup-buttons-touch',
    title: 'AI review buttons do nothing when tapped',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the aiAssist plugin on touch screens',
    applies: inCode,
    codeMatch: /aiAssist|aiImproveWriting/,
    problem: 'On a phone, Insert, Cancel, Accept and Reject in an AI review, and Send in Ask AI, do nothing.',
    fix: `Call popupTaps() once on the page.\n\n${snippet('popupTaps')}`,
    tested: DEMO
  },
  {
    id: 'ai-options-escaping',
    title: 'AI tone and language items break on quotes',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the aiAssist plugin',
    applies: inCode,
    codeMatch: /aiAssistToneOptions|aiAssistTranslateOptions/,
    problem: 'A double quote in a prompt cuts it short, and markup in a title is drawn as HTML.',
    fix: 'Keep quotes and markup out of the title and prompt of aiAssistToneOptions and aiAssistTranslateOptions.',
    tested: READ
  },
  {
    id: 'ai-before-insert',
    title: 'aiAssist.beforeInsert cannot change what goes in',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the aiAssist plugin',
    applies: inCode,
    codeMatch: /aiAssist\.beforeInsert/,
    problem: 'The event has one argument, the HTML, and its return value can only cancel. The popup has already shown the HTML by then.',
    fix: 'Sanitize the answer in your aiAssistRequest handler instead.',
    tested: SEEN
  },
  {
    id: 'ai-chat-stop-title',
    title: 'The AI Chat stop button is named Send while it streams',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the aiAssist plugin',
    applies: inCode,
    codeMatch: /aiChatAssistant/,
    problem: 'Screen readers and tooltips say Send while the answer streams.',
    fix: 'Set the title of the button yourself while your request runs.',
    tested: SEEN
  },
  {
    id: 'markdown-set-markdown',
    title: 'setMarkdown() loses line breaks or breaks the editor',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the markdown plugin',
    applies: inCode,
    codeMatch: /setMarkdown/,
    problem:
      'In Markdown mode the text shows on one line, and one switch to Rich Text and back drops its line breaks. Outside Markdown mode, setMarkdown() returns null and the Markdown button then throws an error.',
    fix: 'Switch to Markdown mode with markdown.toggle() first. For stored content, convert the Markdown to HTML yourself and call html.set().',
    tested: SEEN
  },
  {
    id: 'markdown-comment',
    title: 'getMarkdown() adds an HTML comment after a list',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the markdown plugin',
    applies: inCode,
    codeMatch: /getMarkdown/,
    problem: 'The result has <!-- --> after a list.',
    fix: "Remove it from the result. markdown.replace(/<!-- -->\\n?/g, '')",
    tested: SEEN
  },
  {
    id: 'filestack-custom-toolbar',
    title: 'Filestack-only mode keeps your own upload buttons',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the filestack plugin',
    applies: inCode,
    codeMatch: /uploadToFilestackOnly/,
    problem: 'With a flat toolbar, or groups not named moreRich, the toolbar keeps the image, video and file buttons of the editor.',
    fix: 'Put those buttons in a moreRich group, or leave them out of the toolbar and use openFilePicker.',
    tested: READ
  },
  {
    id: 'image-editor-keyboard',
    title: 'An editor started on an image takes no keys',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older, with an editor started on an img element',
    applies: inCode,
    codeMatch: /new\s+\w*Froala\w*\(\s*['"`]img|froalaEditor[^>]*<img/,
    problem: 'The image popup and the image manager work with the pointer only. Remove clears the src and leaves an empty, oversized image.',
    fix: 'Add your own upload button and link field that call image.upload and image.insert, and leave imageRemove out of imageEditButtons.',
    tested: SEEN
  },
  {
    id: 'init-on-click-errors',
    title: 'initOnClick throws an error before the first click',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with initOnClick',
    applies: inCode,
    codeMatch: /initOnClick/,
    problem: 'A scroll or a click outside the editor before the first click logs "Cannot read properties of undefined (reading \'get\')". The editor still works.',
    fix: 'Start the editor from your own click handler instead of initOnClick, or ignore this message.',
    tested: SEEN
  },
  {
    id: 'button-editor-tab',
    title: 'Tab on an editor started on a button throws an error',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older, with an editor started on a button',
    applies: inCode,
    codeMatch: /new\s+\w*Froala\w*\(\s*['"`]button/,
    problem: 'Pressing Tab logs "Cannot read properties of undefined (reading \'find\')". The lists plugin expects a toolbar.',
    fix: 'Leave out the lists plugin in that editor with pluginsDisabled.',
    tested: SEEN
  },
  {
    id: 'romanian-undo-redo',
    title: 'Romanian swaps Undo and Redo',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with language "ro"',
    applies: inCode,
    codeMatch: /language\s*:\s*['"]ro['"]/,
    problem: 'The tooltips of Undo and Redo are swapped, and the list types stay in English.',
    fix: "Correct them after the language file loads. FroalaEditor.LANGUAGE.ro.translation.Undo = 'Anuleaz\u0103'; and FroalaEditor.LANGUAGE.ro.translation.Redo = 'Ref\u0103';",
    tested: READ
  },
  {
    id: 'shortcuts-enabled-browser-keys',
    title: 'shortcutsEnabled does not stop browser formatting keys',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with shortcutsEnabled',
    applies: inCode,
    codeMatch: /shortcutsEnabled/,
    problem: 'Leaving underline out of shortcutsEnabled still lets Chrome underline with Ctrl or Cmd with U.',
    fix: 'Stop the key in a keydown handler if the format must not be used, and remove the format with htmlAllowedTags.',
    tested: SEEN
  },
  {
    id: 'shortcut-event',
    title: 'The shortcut event does not fire for toolbar buttons',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older',
    applies: inCode,
    codeMatch: /['"]?shortcut['"]?\s*[:(]/,
    problem: 'With bold in the toolbar, a shortcut handler in events never runs for Ctrl or Cmd with B.',
    fix: 'Add the handler with editor.events.on("shortcut", handler, true), which runs first.',
    tested: SEEN
  },
  {
    id: 'save-button-icon',
    title: 'The save button draws no icon',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the save plugin',
    applies: inCode,
    codeMatch: /['"]save['"]/,
    problem: 'The button is empty, because its icon has no SVG path.',
    fix: "Give it a text label. FroalaEditor.DefineIcon('save', { NAME: 'Save', template: 'text' });",
    tested: READ
  },
  {
    id: 'image-icon-template',
    title: 'The image icon template does not quote its alt text',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with custom icons',
    applies: inCode,
    codeMatch: /template\s*:\s*['"]image['"]/,
    problem: 'An ALT with a space breaks at the space.',
    fix: 'Use one word for ALT, or define your own icon template.',
    tested: READ
  },
  {
    id: 'strict-typescript-callbacks',
    title: 'Two Froala types are too loose for strict TypeScript',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older in a TypeScript project',
    applies: (p) => dependsOnCode(p.typescript, core(p)),
    codeMatch: /RegisterQuickInsertButton|image\.get\(\)/,
    problem: 'RegisterQuickInsertButton types its parameters as object, and image.get() returns object, so this and .attr() fail the type check.',
    fix: 'Give such callbacks this: any, and cast the result of image.get().',
    tested: READ
  },
  {
    id: 'react-view-types',
    title: 'FroalaEditorView has no types of its own',
    targets: ['react', 'nextjs'],
    affects: 'react-froala-wysiwyg 5.6.0 or older in a TypeScript project',
    applies: (p) => dependsOnCode(usesReactWrapper(p) && p.typescript, froalaAtMost(p, 'react-froala-wysiwyg', FROALA_VERSION)),
    codeMatch: /react-froala-wysiwyg\/Froala/,
    problem: 'Importing only react-froala-wysiwyg/FroalaEditorView fails with "Could not find a declaration file".',
    fix: 'Add this line at the top of the file. /// <reference types="react-froala-wysiwyg" />',
    tested: 'Tested with TypeScript 7 and react-froala-wysiwyg 5.5.0 (October 2026).'
  },
  {
    id: 'nuxt-browser-only',
    title: 'Nuxt fails with "Element is not defined"',
    targets: ['nuxt'],
    affects: 'Nuxt with any Froala version',
    applies: (p) => when(p.target === 'nuxt'),
    problem: 'Nuxt renders pages on the server, and importing Froala there fails with "ReferenceError: Element is not defined" or "document is not defined".',
    fix: 'Load Froala in a plugin whose file name ends in .client, and wrap <froala> in <ClientOnly>. froala_get_setup with target "nuxt" gives these files.',
    tested: 'Nuxt 4.6 build and preview (4 Nov 2026).'
  },
  {
    id: 'window-escape',
    title: 'Esc does not close the code snippet window',
    targets: 'all',
    affects: 'froala-editor 5.6.0 or older with the codeSnippet plugin',
    applies: inCode,
    codeMatch: /codeSnippet|code_snippet/,
    enhancement: 'windowEscape',
    problem: 'Esc in the code field of Insert Code Snippet leaves the window open.',
    fix: enhancementFix('windowEscape'),
    tested: CHECKED
  },
  {
    id: 'sveltekit-server-rendering',
    title: 'SvelteKit fails with "Element is not defined"',
    targets: ['svelte'],
    affects: 'SvelteKit with any Froala version',
    applies: (p) => when(p.target === 'svelte' && p.has('@sveltejs/kit')),
    problem: 'SvelteKit renders pages on the server, and importing Froala there fails.',
    fix: 'In the +page.ts or +layout.ts of the route that shows the editor, add export const ssr = false;',
    tested: 'SvelteKit 3.1 build and preview (4 Nov 2026).'
  },
  {
    id: 'sveltekit-lib-alias',
    title: 'The $lib alias is gone in SvelteKit 3',
    targets: ['svelte'],
    affects: 'SvelteKit 3 and newer',
    applies: (p) => (p.target === 'svelte' ? isAtLeast(p, '@sveltejs/kit', '3.0.0') : 'no'),
    codeMatch: /\$lib\//,
    problem: "An import from '$lib/...' fails to resolve, because SvelteKit 3 renamed the alias to #lib.",
    fix: "Use '#lib/...' in SvelteKit 3 and newer.",
    tested: 'SvelteKit 3.1 build (4 Nov 2026).'
  },
  {
    id: 'svelte-types',
    title: 'Svelte TypeScript check fails with TS7016',
    targets: ['svelte'],
    affects: 'svelte-froala-wysiwyg 5.6.0 or older in a TypeScript project',
    applies: (p) => (p.target === 'svelte' && p.typescript ? froalaAtMost(p, 'svelte-froala-wysiwyg', FROALA_VERSION) : 'no'),
    problem: 'svelte-check reports that it could not find a declaration file for svelte-froala-wysiwyg, because the wrapper ships without types.',
    fix: `Add a declaration file, for example src/froala.d.ts.

\`\`\`ts
declare module 'svelte-froala-wysiwyg';
\`\`\``,
    tested: 'svelte-check with TypeScript (11 Oct 2026).'
  },
  {
    id: 'docs-differences',
    title: 'Some docs pages differ from the package',
    targets: 'all',
    affects: 'Froala 5.6.0',
    applies: core,
    codeMatch: /lineBreakerOffset|filesManagerUploadURL|toolbarSticky|toolbarBottom|emoticonsStep|codeBeautifier\.run|image\.insertByURL/,
    problem:
      'lineBreakerOffset is 15, not 20. filesManagerUploadURL is null by default. toolbarSticky false lets the toolbar scroll away. toolbarBottom stays at the bottom on phones. emoticonsStep is no longer read. codeBeautifier.run and image.insertByURL exist but are not on the Methods page.',
    fix: 'Follow the behaviour described here. froala_query_docs returns the package defaults in lookup mode.',
    tested: READ
  },
  {
    id: 'vite8-react-import',
    title: 'React wrapper shows a blank page with Vite 8',
    targets: ['react'],
    affects: 'react-froala-wysiwyg 5.5.0 or older, Vite 8 or newer, and "type": "module" in package.json',
    applies: (p) => (p.target === 'react' ? wrapperImportBug(p, 'react-froala-wysiwyg') : 'no'),
    problem: 'The usual import gives a blank page, and the console shows "Element type is invalid ... but got: object". Vite 8 hands back the whole CommonJS module instead of its default export.',
    fix: `Upgrade froala-editor and react-froala-wysiwyg to 5.6.0 or newer, which fixes this. On an older version, take the component from the module.

\`\`\`tsx
// Use this in place of the plain default import.
import FroalaEditorComponentImport from 'react-froala-wysiwyg';

const FroalaEditorComponent =
  (FroalaEditorComponentImport as unknown as { default?: typeof FroalaEditorComponentImport }).default ?? FroalaEditorComponentImport;
\`\`\`

In JavaScript: const FroalaEditorComponent = FroalaEditorComponentImport.default ?? FroalaEditorComponentImport;`,
    tested:
      'Fresh Vite 8.3 and React 19.3 project with react-froala-wysiwyg 5.5.0, dev server and production build (11 Oct 2026). On 12 Oct 2026, React apps built with this import rendered and worked in Chrome; an AI agent that used the plain import got a blank page first.'
  },
  {
    id: 'vite8-vue-plugin',
    title: 'Vue wrapper shows a blank page with Vite 8 or Nuxt 4.5 and newer',
    targets: ['vue', 'nuxt'],
    affects: 'vue-froala-wysiwyg 5.5.0 or older with Vite 8 or Nuxt 4.5 and newer, and "type": "module" in package.json',
    applies: (p) => (usesVueWrapper(p) ? wrapperImportBug(p, 'vue-froala-wysiwyg') : 'no'),
    problem:
      'The page is blank and <froala> stays an unknown element. Vue warns "A plugin must either be a function or an object with an install function". Vite 8 hands back the whole CommonJS module instead of its default export.',
    fix: `Upgrade froala-editor and vue-froala-wysiwyg to 5.6.0 or newer, which fixes this. On an older version, take the plugin from the module.

\`\`\`ts
// Use this in place of the plain default import.
import VueFroalaImport from 'vue-froala-wysiwyg';

const VueFroala = VueFroalaImport.default ?? VueFroalaImport;

app.use(VueFroala); // In a Nuxt plugin: nuxtApp.vueApp.use(VueFroala)
\`\`\``,
    tested:
      'Fresh create-vue project with Vite 8.3 and Vue 3.5 (11 Oct 2026). On 12 Oct 2026, Vue and Nuxt 4.6 apps built with this import rendered and worked in Chrome; with the plain import the Nuxt build passed and the page showed an inert <froala> element.'
  },
  {
    id: 'vue-types',
    title: 'Vue TypeScript build fails with TS7016',
    targets: ['vue', 'nuxt'],
    affects: 'vue-froala-wysiwyg 5.6.0 or older in a TypeScript project',
    applies: (p) => (usesVueWrapper(p) && p.typescript ? froalaAtMost(p, 'vue-froala-wysiwyg', FROALA_VERSION) : 'no'),
    problem: 'npm run build fails with "Could not find a declaration file for module vue-froala-wysiwyg", because the wrapper ships without type declarations.',
    fix: `Add a declaration file, for example src/froala.d.ts.

\`\`\`ts
declare module 'vue-froala-wysiwyg';
\`\`\``,
    tested: 'create-vue starter build with vue-tsc (11 Oct 2026).'
  },
  {
    id: 'plugin-types',
    title: 'TypeScript reports TS7016 for dynamic imports of Froala plugins',
    targets: ['nextjs', 'angular'],
    affects: 'froala-editor 5.6.0 or older in a TypeScript project that loads plugins with import(), as the server rendering examples do',
    applies: (p) => dependsOnCode((p.target === 'nextjs' || p.target === 'angular') && p.typescript, froalaAtMost(p, 'froala-editor', FROALA_VERSION)),
    problem: "import('froala-editor/js/plugins.pkgd.min.js') fails the type check with TS7016, because the plugin files have no type declarations. Plain import lines are fine.",
    fix: `Add a declaration file, for example src/froala-plugins.d.ts.

\`\`\`ts
declare module 'froala-editor/js/plugins/*';
declare module 'froala-editor/js/plugins.pkgd.min.js';
\`\`\``,
    tested: 'Next.js 16 type check with the README server rendering example (11 Oct 2026).'
  },
  {
    id: 'nextjs-browser-only',
    title: 'Next.js build fails with "Element is not defined"',
    targets: ['nextjs'],
    affects: 'Next.js with any Froala version (tested with Next.js 16)',
    applies: (p) => when(p.target === 'nextjs'),
    problem:
      'next build fails with "ReferenceError: Element is not defined", even in a "use client" component, because Next.js also renders client components once on the server. The README server-side rendering example fails too.',
    fix: `Keep the editor in a client component and load that component without server rendering.

\`\`\`tsx
// app/components/FroalaEditor.tsx
'use client';

import dynamic from 'next/dynamic';

const FroalaEditor = dynamic(() => import('./FroalaEditorClient'), { ssr: false });

export default FroalaEditor;
\`\`\`

FroalaEditorClient.tsx is a "use client" component that imports react-froala-wysiwyg, the CSS and the plugins. froala_get_setup with target "nextjs" gives both files.`,
    tested: 'Next.js 16 App Router, next build and next start (11 Oct 2026).'
  },
  {
    id: 'angular-standalone',
    title: 'Angular standalone components fail with forRoot()',
    targets: ['angular'],
    affects: 'angular-froala-wysiwyg 5.6.0 or older with Angular 19 or newer',
    applies: (p) => (p.target === 'angular' ? isAtLeast(p, '@angular/core', '19.0.0') : 'no'),
    problem: 'The README shows NgModule setup with FroalaEditorModule.forRoot(). New Angular apps use standalone components, where forRoot() fails with NG2012 and TS2322.',
    fix: `List the modules directly in the component.

\`\`\`ts
@Component({
  selector: 'app-editor',
  imports: [FroalaEditorModule, FroalaViewModule],
  template: \`<div [froalaEditor]="options" [(froalaModel)]="content"></div>\`
})
export class EditorComponent {}
\`\`\``,
    tested: 'Angular 22 ng build, standalone and zoneless (11 Oct 2026).'
  },
  {
    id: 'angular-styles-path',
    title: 'Angular build cannot find "styles.css"',
    targets: ['angular'],
    affects: 'Angular projects that follow the README angular.json snippet',
    applies: (p) => dependsOnCode(p.target === 'angular', 'yes'),
    problem: 'The README angular.json snippet lists "styles.css". New projects keep that file in src/, so the build fails with "Could not resolve styles.css".',
    fix: `In angular.json, keep your own styles path and add Froala's CSS after it.

\`\`\`json
"styles": [
  "src/styles.css",
  "node_modules/froala-editor/css/froala_editor.pkgd.min.css",
  "node_modules/froala-editor/css/froala_style.min.css"
]
\`\`\``,
    tested: 'Angular 22 ng build (11 Oct 2026).'
  },
  {
    id: 'angular-bundle-budget',
    title: 'Angular build fails the bundle budget with all plugins',
    targets: ['angular'],
    affects: 'Angular projects that import Froala plugins at the top of a file',
    applies: (p) => dependsOnCode(p.target === 'angular', 'yes'),
    problem:
      'Importing plugins at the top of a component puts Froala in the initial bundle, and ng build fails with "bundle initial exceeded maximum budget". The bundle is 2.55 MB with every plugin, and 1.25 MB even with five plugins, against the default 1 MB.',
    fix: 'Load the plugins with import() after the page starts and show the editor when they have loaded. froala_get_setup with target "angular" gives this component. Raising the "initial" budget in angular.json also works, but makes the first load slower.',
    tested: 'Angular 22 ng build (11 and 12 Oct 2026). The lazy component built within the default budget and rendered in Chrome.'
  },
  {
    id: 'angular-ssr',
    title: 'Angular server-side rendering fails with "document is not defined"',
    targets: ['angular'],
    affects: 'Angular projects with server-side rendering (@angular/ssr)',
    applies: (p) => when(p.target === 'angular' && usesAngularSsr(p)),
    problem: 'Importing Froala plugins at the top of a file breaks the server build with "document is not defined", and no routes are prerendered.',
    fix: `Load the plugins in the browser only, then show the editor.

\`\`\`ts
import { Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FroalaEditorModule } from 'angular-froala-wysiwyg';

@Component({
  selector: 'app-editor',
  imports: [FroalaEditorModule],
  template: \`@if (ready()) { <div [froalaEditor]="options" [(froalaModel)]="content"></div> }\`
})
export class EditorComponent {
  ready = signal(false);
  content = '';
  options = {};

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      import('froala-editor/js/plugins.pkgd.min.js').then(() => this.ready.set(true));
    }
  }
}
\`\`\`

If TypeScript reports TS7016 for the import, see the plugin-types issue.`,
    tested: 'Angular 22 with ng new --ssr confirmed the failure, and browser-only loading follows the wrapper README (11 Oct 2026).'
  },
  {
    id: 'react-strict-mode-events',
    title: 'Event handlers run twice in React development mode',
    targets: ['react', 'nextjs'],
    affects: 'react-froala-wysiwyg 5.6.0 or older with React StrictMode (on by default in Vite)',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', FROALA_VERSION)),
    problem: 'With StrictMode, the initialized event runs 3 times in development, so handlers added inside it with editor.events.on fire twice per keystroke.',
    fix: `Put handlers in config.events instead of adding them inside initialized.

\`\`\`ts
const config = {
  events: {
    keyup: function () {
      // runs once per key
    }
  }
};
\`\`\``,
    tested: 'React 19.3 and Vite 8.3 dev server, with and without StrictMode (12 Oct 2026).'
  },
  {
    id: 'react-model-change-on-load',
    title: 'onModelChange runs when the editor loads',
    targets: ['react', 'nextjs'],
    affects: 'react-froala-wysiwyg 5.6.0 or older',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', FROALA_VERSION)),
    problem: 'onModelChange runs once as the editor loads, before anyone types, so a form looks edited.',
    fix: `Compare with the starting content before marking the form as changed.

\`\`\`tsx
const initial = useRef(model);

<FroalaEditorComponent
  model={model}
  onModelChange={(value: string) => {
    setModel(value);
    setChanged(value !== initial.current);
  }}
/>
\`\`\`

In JavaScript, leave out : string.`,
    tested: 'React 19.3 (12 Oct 2026).'
  },
  {
    id: 'react-undo-reset',
    title: 'Updating the content from outside clears undo',
    targets: ['react', 'nextjs'],
    affects: 'react-froala-wysiwyg 5.6.0 or older',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', FROALA_VERSION)),
    problem: 'Setting model from your own code, for example after loading a draft, clears the undo history.',
    fix: 'Add the skipReset prop, as in <FroalaEditorComponent skipReset model={model} ... />',
    tested: 'On React 19.3 an outside update cleared the undo history (12 Oct 2026). skipReset comes from the wrapper source.'
  },
  {
    id: 'react-config-changes',
    title: 'Changing the config after start has no effect',
    targets: ['react', 'nextjs'],
    affects: 'react-froala-wysiwyg 5.6.0 or older',
    applies: (p) => dependsOnCode(usesReactWrapper(p), froalaAtMost(p, 'react-froala-wysiwyg', FROALA_VERSION)),
    problem: 'The React wrapper reads config once. Later changes, such as a new placeholder or language, are ignored.',
    fix: 'Give the component a key that changes with the setting, so React starts a fresh editor, as in <FroalaEditorComponent key={language} config={config} ... />',
    tested: 'On React 19.3 the change is ignored (12 Oct 2026). Restarting with a key is standard React behaviour.'
  },
  {
    id: 'react-typescript-model',
    title: 'onModelChange fails strict TypeScript with TS7006',
    targets: ['react', 'nextjs'],
    affects: 'react-froala-wysiwyg 5.6.0 or older in a TypeScript project',
    applies: (p) => dependsOnCode(usesReactWrapper(p) && p.typescript, froalaAtMost(p, 'react-froala-wysiwyg', FROALA_VERSION)),
    problem: 'onModelChange={(model) => ...} fails with "Parameter implicitly has an any type", because the wrapper types onModelChange as object.',
    fix: 'Type the parameter, as in onModelChange={(model: string) => setModel(model)}',
    tested: 'TypeScript 6 strict mode (11 Oct 2026).'
  },
  {
    id: 'event-handler-this',
    title: 'Event handlers from older examples throw errors',
    targets: 'all',
    affects: 'Any Froala 3 or newer project using events',
    applies: () => 'unknown',
    problem: 'Handlers written as function (e, editor) throw on every event, because since Froala 3 the editor is this, not a parameter. Arrow functions lose this as well.',
    fix: `Use a regular function and this.

\`\`\`ts
events: {
  focus: function () {
    console.log(this.html.get());
  }
}
\`\`\``,
    tested: 'Events example from the React wrapper README (11 Oct 2026).'
  },
  {
    id: 'vue-v-model',
    title: 'v-model on <froala> does not update your data',
    targets: ['vue', 'nuxt'],
    affects: 'vue-froala-wysiwyg 5.6.0 or older',
    applies: (p) => dependsOnCode(usesVueWrapper(p), froalaAtMost(p, 'vue-froala-wysiwyg', FROALA_VERSION)),
    problem: 'The Vue component reports changes as value, so plain v-model never receives them.',
    fix: 'Use v-model:value, as in <froala tag="textarea" :config="config" v-model:value="content" />',
    tested: 'Read in the vue-froala-wysiwyg 5.5.0 source (October 2026).'
  },
  {
    id: 'mobile-toolbar',
    title: 'The toolbar wraps to several rows on phones',
    targets: 'all',
    affects: 'Any Froala 5.6.0 or older project using the default toolbar',
    applies: (p) => dependsOnCode(true, froalaAtMost(p, 'froala-editor', FROALA_VERSION)),
    problem: 'On a 375 px wide screen the default toolbar wraps to 3 or 4 rows.',
    fix: `Group the buttons for small screens with toolbarButtonsXS.

\`\`\`ts
toolbarButtonsXS: {
  moreText: { buttons: ['bold', 'italic', 'underline'], buttonsVisible: 2 },
  moreParagraph: { buttons: ['paragraphFormat', 'formatOL', 'formatUL'], buttonsVisible: 0 },
  moreRich: { buttons: ['insertLink', 'insertImage'], buttonsVisible: 0 },
  moreMisc: { buttons: ['undo', 'redo'], align: 'right', buttonsVisible: 2 }
}
\`\`\``,
    tested: 'Row count measured in October 2026. The fix uses the documented toolbarButtonsXS setting.'
  },
  {
    id: 'word-export',
    title: 'Word export files may not open outside Microsoft Word',
    targets: 'all',
    affects: 'Projects using Export to Word (html-docx-js)',
    applies: (p) => when(p.has('html-docx-js')),
    problem: 'Export to Word uses html-docx-js, whose own README says its files open in Microsoft Word but not in LibreOffice or Google Docs.',
    fix: 'If your users need other apps, convert the HTML to DOCX on your server instead. Otherwise tell users to open exports in Microsoft Word.',
    tested: 'Based on the html-docx-js 0.3.1 README.'
  },
  {
    id: 'pdf-export',
    title: 'PDF export creates image-only pages',
    targets: 'all',
    affects: 'Projects using Export to PDF (html2pdf.js)',
    applies: (p) => when(p.has('html2pdf.js')),
    problem: 'The getPDF button uses html2pdf.js in the browser, which draws the content as images, so the text in the PDF cannot be selected or searched.',
    fix: 'For PDFs with real text, render the HTML on your server, for example with a headless browser that prints to PDF.',
    tested: 'Read in the Froala 5.5.0 print plugin and the html2pdf.js docs (October 2026).'
  },
  {
    id: 'helper-library-versions',
    title: 'The docs load helper library versions with known security issues',
    targets: 'all',
    affects: 'Projects using Import from Word (mammoth) or code view with CodeMirror',
    applies: (p) => {
      const below = (pkg: string, fixed: string): Answer => {
        if (!p.has(pkg)) return 'no';
        const answer = isAtLeast(p, pkg, fixed);
        return answer === 'unknown' ? 'unknown' : answer === 'yes' ? 'no' : 'yes';
      };
      const answers = [below('mammoth', '1.11.0'), below('codemirror', '5.58.2')];
      return answers.includes('yes') ? 'yes' : answers.includes('unknown') ? 'unknown' : 'no';
    },
    problem:
      'The Froala docs load mammoth 1.4.21 and CodeMirror 5.3.0. Both versions have known security issues, GHSA-rmjr-87wv-gf87 (mammoth, fixed in 1.11.0) and GHSA-4gw3-8f77-f72c (CodeMirror, fixed in 5.58.2).',
    fix: 'Use mammoth 1.11.0 or newer and CodeMirror 5.65.21.',
    tested: 'GitHub Advisory Database (October 2026).'
  }
];

// Ready-made editor setups for common uses, like the presets in CKEditor Builder.
// Each recipe is framework-neutral: settings plus the plugin files they need.
// Use them with froala_get_setup, which wires the editor into a framework.
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { metadata, FROALA_VERSION, SOURCE } from '../data.js';
import { ESSENTIALS_TOOLBAR, EDITOR_CSS, toJs } from '../templates/shared.js';
import { READ_ONLY, toolResult } from '../util.js';

interface Recipe {
  id: string;
  title: string;
  useWhen: string;
  /** Editor settings. Display-only recipes have none. */
  config?: Record<string, unknown>;
  /** Plugins needed by settings rather than by toolbar buttons. */
  extraPlugins?: string[];
  notes: string[];
  /** Code to use instead of settings, for recipes that aren't an editor. One example per framework. */
  snippets?: { title: string; language: string; install?: string; code: string }[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'classic',
    title: 'Classic editor',
    useWhen: 'General editing in forms, admin panels and content management. Toolbar above the content.',
    config: { toolbarButtons: ESSENTIALS_TOOLBAR, heightMin: 300 },
    notes: ['This is the same toolbar froala_get_setup uses by default.']
  },
  {
    id: 'document',
    title: 'Document editor',
    useWhen: 'Long documents such as contracts, reports and letters, edited on a page-like sheet.',
    config: {
      documentReady: true,
      toolbarButtons: {
        moreText: { buttons: ['bold', 'italic', 'underline', 'fontFamily', 'fontSize', 'textColor', 'backgroundColor', 'clearFormatting'] },
        moreParagraph: { buttons: ['paragraphFormat', 'alignLeft', 'alignCenter', 'alignRight', 'alignJustify', 'formatOL', 'formatUL', 'lineHeight', 'quote'] },
        moreRich: { buttons: ['insertLink', 'insertImage', 'insertTable', 'pageBreak', 'insertHR'] },
        moreMisc: { buttons: ['undo', 'redo', 'print', 'fullscreen'], align: 'right', buttonsVisible: 2 }
      }
    },
    notes: [
      'documentReady gives a page-like layout with settings suited to documents.',
      'Word and PDF export need helper libraries. Call froala_workarounds with id "word-export" or "pdf-export" before adding them.'
    ]
  },
  {
    id: 'inline',
    title: 'Inline editor',
    useWhen: 'Editing text in place on the page, as in a website builder or landing page. The toolbar appears when the text is clicked.',
    config: {
      toolbarInline: true,
      toolbarVisibleWithoutSelection: true,
      toolbarButtons: ['bold', 'italic', 'underline', 'paragraphFormat', 'formatUL', 'formatOL', 'insertLink', 'insertImage']
    },
    notes: ['Attach the editor to the element you want to edit, such as a heading or a section of the page.']
  },
  {
    id: 'balloon',
    title: 'Balloon editor',
    useWhen: 'Clean writing screens, such as blog posts or notes. The toolbar appears only when text is selected.',
    config: {
      toolbarInline: true,
      toolbarVisibleWithoutSelection: false,
      toolbarButtons: ['bold', 'italic', 'underline', 'insertLink', 'formatUL', 'formatOL']
    },
    notes: ['Add a placeholderText so people know where to start typing.']
  },
  {
    id: 'minimal',
    title: 'Minimal editor',
    useWhen: 'Comments, short descriptions and form fields that need only basic formatting.',
    config: {
      toolbarButtons: ['bold', 'italic', 'underline', 'insertLink', 'formatUL', 'formatOL'],
      quickInsertEnabled: false,
      heightMin: 120,
      charCounterMax: 2000
    },
    extraPlugins: ['charCounter'],
    notes: ['charCounterMax limits the length and shows a counter. Remove it, and the charCounter plugin, if you do not need a limit.']
  },
  {
    id: 'chat',
    title: 'Chat message box',
    useWhen: 'Chat, messaging and support replies. A small box with the toolbar below the text.',
    config: {
      toolbarBottom: true,
      toolbarButtons: ['bold', 'italic', 'insertLink', 'emoticons'],
      quickInsertEnabled: false,
      placeholderText: 'Write a message',
      heightMin: 60,
      heightMax: 200
    },
    notes: ['Read the message with the model value (or editor.html.get()) when the user sends it, then clear it.']
  },
  {
    id: 'email',
    title: 'Email editor',
    useWhen: 'Newsletters, marketing emails and email templates.',
    config: {
      useClasses: false,
      toolbarButtons: {
        moreText: { buttons: ['bold', 'italic', 'underline', 'fontFamily', 'fontSize', 'textColor', 'backgroundColor'] },
        moreParagraph: { buttons: ['paragraphFormat', 'alignLeft', 'alignCenter', 'alignRight', 'formatOL', 'formatUL'] },
        moreRich: { buttons: ['insertLink', 'insertImage', 'insertTable', 'insertHR'] },
        moreMisc: { buttons: ['undo', 'redo', 'html'], align: 'right', buttonsVisible: 2 }
      }
    },
    notes: [
      'useClasses: false writes styles inline, which email clients need.',
      'Images in emails need public URLs. Set imageUploadURL to an endpoint on your server that stores the image and returns its URL.',
      'Check the result in the email clients your readers use before sending.'
    ]
  },
  {
    id: 'html',
    title: 'HTML editor',
    useWhen: 'Editing HTML directly, for developers or advanced content teams. The html button switches to code view.',
    config: {
      toolbarButtons: {
        moreText: { buttons: ['bold', 'italic', 'underline', 'clearFormatting'] },
        moreParagraph: { buttons: ['paragraphFormat', 'formatOL', 'formatUL'] },
        moreRich: { buttons: ['insertLink', 'insertImage', 'insertTable'] },
        moreMisc: { buttons: ['html', 'undo', 'redo', 'fullscreen'], align: 'right', buttonsVisible: 4 }
      }
    },
    extraPlugins: ['codeBeautifier'],
    notes: [
      'Code view works without extra libraries. For syntax highlighting, install codemirror 5.65.21 and pass codeMirror: CodeMirror in the settings.',
      'Froala removes <script> and <style> tags by default (htmlRemoveTags). Keep that unless you trust everyone who edits.'
    ]
  },
  {
    id: 'markdown',
    title: 'Markdown editor',
    useWhen: 'People who prefer writing Markdown, such as developer docs or knowledge bases.',
    config: { toolbarButtons: ['bold', 'italic', 'formatOL', 'formatUL', 'insertLink', 'insertImage', 'markdown'] },
    notes: ['The markdown button opens a split view: write Markdown on one side and see the result on the other.']
  },
  {
    id: 'display',
    title: 'Show saved content',
    useWhen: 'Showing HTML that was written in Froala, for example on a public page.',
    notes: [
      'Load froala_style.min.css on the page and wrap the HTML in an element with class fr-view, so it looks the same as in the editor.',
      'If the HTML can come from users, sanitize it before showing it, on your server or with DOMPurify in the browser.'
    ],
    snippets: [
      {
        title: 'React',
        language: 'tsx',
        install: 'npm install dompurify',
        code: `import DOMPurify from 'dompurify';
import 'froala-editor/css/froala_style.min.css';

export function SavedContent({ html }: { html: string }) {
  return <div className="fr-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}`
      },
      {
        title: 'Plain HTML, with the HTML sanitized on your server',
        language: 'html',
        code: `<link href="https://cdn.jsdelivr.net/npm/froala-editor@${FROALA_VERSION}/css/froala_style.min.css" rel="stylesheet">

<div class="fr-view">
  <!-- the saved HTML -->
</div>`
      }
    ]
  }
];

/** Every plugin the recipe needs: those of its toolbar buttons plus its extra plugins. */
export function recipePlugins(recipe: Recipe): string[] {
  const plugins = new Set(recipe.extraPlugins ?? []);
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      const plugin = metadata.buttons[value]?.plugin;
      if (plugin) plugins.add(plugin);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  for (const key of ['toolbarButtons', 'toolbarButtonsMD', 'toolbarButtonsSM', 'toolbarButtonsXS']) collect(recipe.config?.[key]);
  return [...plugins].sort();
}

const input = z.object({
  use_case: z
    .enum(RECIPES.map((r) => r.id) as [string, ...string[]])
    .optional()
    .describe('Which recipe to return. Leave empty to list all recipes.')
});

/** The recipe's settings, plus imageUploadRemoteUrls: false when it has an image button. */
function settingsOf(recipe: Recipe): Record<string, unknown> | undefined {
  if (!recipe.config) return undefined;
  const hasImage = recipePlugins(recipe).includes('image') && !('imageUploadRemoteUrls' in recipe.config);
  return hasImage ? { ...recipe.config, imageUploadRemoteUrls: false } : recipe.config;
}

export function recipes({ use_case }: z.infer<typeof input>) {
  if (!use_case) {
    const list = RECIPES.map((r) => `- ${r.id}: ${r.title}. ${r.useWhen}`).join('\n');
    return toolResult(`Editor recipes. Call froala_recipes with a use_case to get its settings.\n\n${list}`, {
      ...SOURCE,
      recipes: RECIPES.map(({ id, title, useWhen }) => ({ id, title, use_when: useWhen }))
    });
  }
  const recipe = RECIPES.find((r) => r.id === use_case)!;
  const config = settingsOf(recipe);
  const imports = recipePlugins(recipe).map((p) => `import '${metadata.plugins[p].file}';`);
  const notes = [...recipe.notes];
  if (config && config !== recipe.config) notes.push('imageUploadRemoteUrls: false keeps images added by URL as plain links. By default Froala reads them through its hosted proxy.');
  const lines = [`# ${recipe.title}`, recipe.useWhen, ''];
  if (config) {
    lines.push(
      'Plugin imports:',
      '```js',
      imports.length ? imports.join('\n') : '// Core buttons only, no plugin imports needed.',
      '```',
      '',
      'Settings (add your licence key as key):',
      '```js',
      `const config = ${toJs(config)};`,
      '```',
      '',
      `CSS: ${EDITOR_CSS.join(' and ')}.`,
      'To use it in a framework, call froala_get_setup and replace its settings and plugin imports with these.'
    );
  }
  for (const snippet of recipe.snippets ?? []) {
    lines.push(`${snippet.title}:`, ...(snippet.install ? [`Install: ${snippet.install}`] : []), '```' + snippet.language, snippet.code, '```', '');
  }
  lines.push('', ...notes.map((n) => `- ${n}`));
  return toolResult(lines.join('\n'), {
    ...SOURCE,
    id: recipe.id,
    title: recipe.title,
    use_when: recipe.useWhen,
    config: config ?? null,
    plugin_imports: imports,
    notes,
    snippets: recipe.snippets ?? []
  });
}

export const recipesTool = {
  names: ['froala_recipes'],
  instruction: 'When the user describes what the editor is for (comments, chat, email, documents, inline editing and so on), call froala_recipes for matching settings.',
  register(server: McpServer) {
    server.registerTool(
      'froala_recipes',
      {
        title: 'Froala editor recipes',
        description:
          'Ready-made Froala settings for common uses: classic, document, inline, balloon, minimal (comments), chat, email, HTML source and Markdown editors, ' +
          'plus how to show saved content safely. Returns the settings and the plugin imports they need. The settings are a starting point; trim the toolbar to what you need.',
        inputSchema: input,
        annotations: READ_ONLY
      },
      async (args) => recipes(args)
    );
  }
};

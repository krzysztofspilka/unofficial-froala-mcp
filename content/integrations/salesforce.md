---
title: Salesforce Lightning Web Components
summary: Loads Froala from a static resource and starts it in a Lightning Web Component.
targets: javascript
checked: Written from the Salesforce documentation for static resources, platformResourceLoader and lwc:dom. Test it in a sandbox org before you ship it.
---

# Froala in a Lightning Web Component

Lightning Web Components load third-party code from static resources. The component keeps the editor's element out of its template with `lwc:dom="manual"`, so Froala can change that element.

## 1. Upload a static resource

Put these files from the `froala-editor` package in a folder, zip it, and upload it as a static resource named `froala`.

- `js/froala_editor.pkgd.min.js`
- `css/froala_editor.pkgd.min.css`
- `css/froala_style.min.css`

## 2. Add the licence key's domain

Your key must cover the domain your org runs on, for example `yourorg.lightning.force.com`. Keep the key in a custom setting or custom metadata, not in the component's code. To evaluate, use the public trial key `TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE`.

## 3. Create the component

`froalaEditor.html`

```html
<template>
  <div class="editor" lwc:dom="manual"></div>
</template>
```

`froalaEditor.js`

```js
import { LightningElement, api } from 'lwc';
import { loadScript, loadStyle } from 'lightning/platformResourceLoader';
import froala from '@salesforce/resourceUrl/froala';

export default class FroalaEditor extends LightningElement {
  @api licenseKey = 'TRIAL-LICENSE-KEY-FOR-FROALA-NOT-FOR-PRODUCTION-USE';
  @api value = '';
  started = false;
  editor;

  async renderedCallback() {
    if (this.started) return;
    this.started = true;
    await Promise.all([loadStyle(this, `${froala}/css/froala_editor.pkgd.min.css`), loadStyle(this, `${froala}/css/froala_style.min.css`), loadScript(this, `${froala}/js/froala_editor.pkgd.min.js`)]);
    const component = this;
    this.editor = new window.FroalaEditor(this.template.querySelector('.editor'), {
      key: this.licenseKey,
      toolbarButtons: [['undo', 'redo'], ['paragraphFormat'], ['bold', 'italic', 'underline'], ['insertLink', 'insertImage'], ['formatUL', 'formatOL']],
      imageUploadRemoteUrls: false,
      htmlExecuteScripts: false,
      events: {
        initialized() {
          this.html.set(component.value);
        },
        contentChanged() {
          component.dispatchEvent(new CustomEvent('change', { detail: { value: this.html.get() } }));
        }
      }
    });
  }

  disconnectedCallback() {
    this.editor?.destroy();
  }
}
```

## 4. Check the org's security settings

- Turn on Lightning Web Security for the org. It gives third-party code a standard `window` and `document`.
- Add your image and file hosts as CSP Trusted Sites.
- Set `imageUploadURL` to an Apex REST endpoint or to your own server, so uploaded images are stored.

## 5. Save the content

Rich text stored in Salesforce fields is sanitized by the platform, so check that the tags and styles you use survive a save and a reload.

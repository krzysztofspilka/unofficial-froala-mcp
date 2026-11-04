---
title: TanStack Form and Query
summary: Binds the editor to a TanStack Form field and saves its content with TanStack Query.
targets: react
checked: Tested with @tanstack/react-form 1.33, @tanstack/react-query 5.105, React 19.3 and Froala 5.5.0 in Chrome, in a fresh app built from this guide.
---

# Froala with TanStack

These examples start from the files `froala_get_setup` gives a React project, in `src/froala/`.

## TanStack Form

Bind the editor with `model` and `onModelChange`, and tell the field when the editor loses focus. An empty editor still holds markup, so validate the text and not the HTML.

```tsx
import { useForm } from '@tanstack/react-form';
import FroalaEditorComponent from 'react-froala-wysiwyg';
import { froalaConfig } from './froala-preset';

const hasText = (html: string) => !!new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim();

export default function PostForm() {
  const form = useForm({
    defaultValues: { body: '' },
    onSubmit: async ({ value }) => console.log(value.body)
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="body" validators={{ onChange: ({ value }) => (hasText(value) ? undefined : 'Write something first') }}>
        {(field) => (
          <>
            <FroalaEditorComponent
              tag="textarea"
              config={{ ...froalaConfig, immediateReactModelUpdate: true, events: { blur: () => field.handleBlur() } }}
              model={field.state.value}
              onModelChange={(html: string) => field.handleChange(html)}
            />
            {field.state.meta.errors.map((error) => (
              <p key={String(error)}>{String(error)}</p>
            ))}
          </>
        )}
      </form.Field>
      <button type="submit">Publish</button>
    </form>
  );
}
```

`immediateReactModelUpdate` updates the field on every key. Without it the field updates when the editor loses focus, so an error message can disappear as someone clicks the submit button, and the button moves away from the pointer.

The wrapper reads `config` once, when the editor starts.

## TanStack Query

Load the content with `useQuery`, and show the editor once it has arrived, so the first value is the saved one. Save with `useMutation`.

```tsx
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import FroalaEditorComponent from 'react-froala-wysiwyg';
import { froalaConfig } from './froala-preset';

function Editor({ initial }: { initial: string }) {
  const [html, setHtml] = useState(initial);
  const saved = useRef(initial);
  const save = useMutation({
    mutationFn: (body: string) => fetch('/api/post', { method: 'PUT', body }),
    onSuccess: (_response, body) => {
      saved.current = body;
    }
  });

  return (
    <>
      <FroalaEditorComponent tag="textarea" config={froalaConfig} model={html} onModelChange={(value: string) => setHtml(value)} />
      <button onClick={() => save.mutate(html)} disabled={save.isPending || html === saved.current}>
        Save
      </button>
    </>
  );
}

export default function Post() {
  const post = useQuery({ queryKey: ['post'], queryFn: () => fetch('/api/post').then((response) => response.text()) });
  return post.isSuccess ? <Editor initial={post.data} /> : <p>Loading</p>;
}
```

The `onModelChange` callback runs once when the editor loads. Compare the value with the saved one, as this example does, before you treat the form as changed.

Wrap the app in `QueryClientProvider`, as TanStack Query asks.

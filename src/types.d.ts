// Markdown files are bundled as plain text (esbuild loader "text", Wrangler rule "Text").
declare module '*.md' {
  const text: string;
  export default text;
}

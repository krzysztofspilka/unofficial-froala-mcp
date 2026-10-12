/** The most text one answer returns. Tools also keep their structured data small (see their own limits). */
export const MAX_RESPONSE_CHARS = 25_000;
/** The most structured data (as JSON) one answer returns. */
export const MAX_STRUCTURED_CHARS = 60_000;
export const RATE_LIMIT_MESSAGE = "You've reached the limit of 120 tool calls a minute. Please try again in a minute.";

/** Every Froala tool only reads data, so clients can run them without asking. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** A tool answer: readable text for the model, plus the same data as JSON when there is any. */
export function toolResult(text: string, structured?: Record<string, unknown>): ToolResult {
  let body = text;
  if (body.length > MAX_RESPONSE_CHARS) {
    body = `${body.slice(0, MAX_RESPONSE_CHARS)}\n\n[Answer shortened to ${MAX_RESPONSE_CHARS} characters.]`;
  }
  if (!structured) return { content: [{ type: 'text', text: body }] };
  // Tools limit their own lists, so this only guards against a mistake in a tool.
  if (JSON.stringify(structured).length > MAX_STRUCTURED_CHARS) {
    structured = { shortened: true, note: 'The structured answer was too long. Read the text answer instead.' };
  }
  return { content: [{ type: 'text', text: body }], structuredContent: structured };
}

/** A tool answer for input the tool can't use, such as a broken package.json. */
export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

/**
 * The closest known name: an alias, a different letter case, a longer name that starts
 * with the given one (placeholder -> placeholderText), or a small spelling difference.
 */
export function closest(name: string, candidates: Iterable<string>, aliases: Record<string, string> = {}): string | undefined {
  if (aliases[name]) return aliases[name];
  const list = [...candidates];
  const lower = name.toLowerCase();
  const sameCase = list.find((c) => c.toLowerCase() === lower);
  if (sameCase) return sameCase;
  const longer = list.filter((c) => c.toLowerCase().startsWith(lower) && lower.length >= 3).sort((x, y) => x.length - y.length);
  if (longer.length) return longer[0];
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of list) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  const limit = Math.max(2, Math.min(3, Math.floor(name.length / 3)));
  return bestDistance <= limit ? best : undefined;
}

/** Several close names, best first. */
export function closestMany(name: string, candidates: Iterable<string>, count = 5): string[] {
  const lower = name.toLowerCase();
  return [...candidates]
    .map((c) => {
      const cl = c.toLowerCase();
      const score = cl.includes(lower) || lower.includes(cl) ? 0 : levenshtein(lower, cl);
      return { c, score };
    })
    .filter((x) => x.score <= Math.max(3, Math.floor(name.length / 2)))
    .sort((x, y) => x.score - y.score || x.c.length - y.c.length)
    .slice(0, count)
    .map((x) => x.c);
}

import * as z from 'zod/v4';

/** The most text one answer returns. Tools send fewer items, or the next part of a page, to stay under it. */
export const MAX_RESPONSE_CHARS = 30_000;
/** The most structured data (as JSON) one answer returns. */
export const MAX_STRUCTURED_CHARS = 60_000;
export const RATE_LIMIT_MESSAGE = 'You have reached the limit of 120 tool calls a minute. Please try again in a minute.';

/** Every Froala tool only reads data, so clients can run them without asking. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The input every tool shares. */
export const responseFormat = z.enum(['markdown', 'json']).default('markdown').describe('"markdown" (default) for reading, "json" for the same data as JSON text.');
export type ResponseFormat = 'markdown' | 'json';

/** The inputs of a tool that returns a list. */
export const pageInputs = (largest: number, usual: number) => ({
  limit: z.number().int().min(1).max(largest).default(usual).describe(`How many items to return, 1 to ${largest} (default ${usual})`),
  offset: z.number().int().min(0).default(0).describe('How many items to skip, for the next page (default 0)')
});

export interface Page<T> {
  items: T[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

/** One page of a list, with what a client needs to ask for the next one. */
export function paginate<T>(all: T[], limit: number, offset: number): Page<T> {
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  const hasMore = next < all.length;
  return { items, total: all.length, count: items.length, offset, has_more: hasMore, next_offset: hasMore ? next : null };
}

/** The list facts of a page, for structured answers. */
export const pageFacts = ({ total, count, offset, has_more, next_offset }: Page<unknown>) => ({ total, count, offset, has_more, next_offset });

/** The line that tells a client how to get the rest of a list. */
export const moreLine = (page: Page<unknown>) => (page.has_more ? `Showing ${page.count} of ${page.total}. Call again with offset ${page.next_offset} for more.` : '');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** A tool answer, with readable text for the model and the same data as JSON when there is any. */
export function toolResult(text: string, structured?: Record<string, unknown>, format: ResponseFormat = 'markdown'): ToolResult {
  // Tools limit their own lists, so this only guards against a mistake in a tool.
  const tooLong = (value: string) => value.length > MAX_RESPONSE_CHARS;
  const data =
    structured && JSON.stringify(structured).length > MAX_STRUCTURED_CHARS ? { shortened: true, note: 'The structured answer was too long. Ask for less, or for the next part.' } : structured;
  const notice = `\n\n[This answer is longer than ${MAX_RESPONSE_CHARS} characters. Ask for less, or for the next part.]`;
  let body = format === 'json' && data ? JSON.stringify(data, null, 1) : text;
  if (tooLong(body))
    body =
      format === 'json'
        ? JSON.stringify({ shortened: true, note: 'The answer was too long for JSON text. Read the structured content, or ask for less.' })
        : body.slice(0, MAX_RESPONSE_CHARS - notice.length) + notice;
  return data ? { content: [{ type: 'text', text: body }], structuredContent: data } : { content: [{ type: 'text', text: body }] };
}

/** A tool answer for input the tool cannot use, such as a broken package.json. It says what to do next. */
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
 * The closest known name. It can be an alias, a different letter case, a longer name that starts
 * with the given one (placeholder gives placeholderText), or a small spelling difference.
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

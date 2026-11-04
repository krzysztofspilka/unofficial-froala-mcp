// The hosted version, on Cloudflare Workers.
// Workers treat every value exported from this file as an entry point, so it exports only the handler (and types).
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createFroalaServer, TOOL_NAMES, VERSION } from './server.js';
import { RATE_LIMIT_MESSAGE } from './util.js';
import { FROALA_VERSION } from './data.js';

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  RATE_LIMITER?: RateLimiter;
  /** Comma-separated origins allowed to call /mcp from a browser, such as "https://example.com". */
  ALLOWED_ORIGINS?: string;
}

const MAX_BODY_BYTES = 512 * 1024;

const handler = createMcpHandler(() => createFroalaServer());

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Reads the request body, stopping as soon as it is larger than the limit (whatever Content-Length says). */
async function readBody(request: Request): Promise<Uint8Array | 'too large'> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return 'too large';
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const MCP_METHODS = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call', 'prompts/list', 'prompts/get', 'resources/list']);
/** More messages than this in one request are refused. Real clients send one. */
const MAX_BATCH = 20;

interface Call {
  method: string;
  tool?: string;
}

/** The method and tool name of every message in the request, each only if it is a known one. Nothing else is read. */
function describeCalls(body: Uint8Array): Call[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return [];
  }
  const messages = (Array.isArray(parsed) ? parsed : [parsed]) as ({ method?: unknown; params?: { name?: unknown } } | null)[];
  return messages.flatMap((message) => {
    if (typeof message?.method !== 'string') return [];
    const method = MCP_METHODS.has(message.method) ? message.method : 'other';
    const name = message.params?.name;
    return [{ method, tool: method === 'tools/call' && typeof name === 'string' && TOOL_NAMES.includes(name) ? name : undefined }];
  });
}

/**
 * Browsers send an Origin header; AI tools and servers usually do not. Requests without one are allowed.
 * Requests from a browser page are allowed only from local development pages (such as MCP Inspector)
 * or the origins listed in ALLOWED_ORIGINS, as the MCP specification asks of HTTP servers.
 */
function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .includes(origin);
}

const ALLOWED_HEADERS = 'content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id, authorization';

/** What a browser needs to call this server from an allowed page. Calls from AI tools send no Origin and get nothing extra. */
const corsHeaders = (origin: string | null): Record<string, string> =>
  origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version, retry-after',
        vary: 'origin'
      }
    : {};

/** The client's name and version from its user agent, such as "claude-code/2.1.0", at most 40 characters. */
const clientOf = (userAgent: string | null) => (userAgent?.split(/\s/)[0] ?? 'unknown').replace(/[^\w./-]/g, '').slice(0, 40) || 'unknown';

/** Adds headers to a response from the MCP library. */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  const merged = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) merged.headers.set(name, value);
  return merged;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json(200, { ok: true, server: VERSION, froala: FROALA_VERSION });
    }
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('Froala MCP server. Connect your AI tool to /mcp on this host.\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    if (url.pathname !== '/mcp') return new Response('Not found\n', { status: 404 });
    const origin = request.headers.get('origin');
    if (!originAllowed(origin, env)) return json(403, { error: 'Requests from this website are not allowed.' });
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': ALLOWED_HEADERS, 'access-control-max-age': '86400' }
      });
    }

    const started = Date.now();
    /** Statistics only. Arguments, code and questions are never logged, and a tool name must be a known tool. */
    const logCall = (status: number, calls: Call[]) => {
      const tools = calls.filter((call) => call.method === 'tools/call').map((call) => call.tool ?? 'unknown tool');
      const cf = (request as Request & { cf?: { country?: string } }).cf;
      console.log(
        JSON.stringify({
          event: 'mcp',
          call: calls[0]?.tool ?? calls[0]?.method ?? request.method,
          calls: calls.length,
          tools,
          http_status: status,
          ms: Date.now() - started,
          country: cf?.country ?? null,
          client: clientOf(request.headers.get('user-agent'))
        })
      );
    };

    const body = await readBody(request);
    if (body === 'too large') {
      logCall(413, []);
      return json(413, { error: 'The request is too large. Send at most 200,000 characters of code.' }, cors);
    }
    const calls = request.method === 'POST' ? describeCalls(body) : [];
    if (calls.length > MAX_BATCH) {
      logCall(400, calls);
      return json(400, { error: `Send at most ${MAX_BATCH} messages in one request.` }, cors);
    }

    // Every tool call in the request counts. Connecting and listing tools never use up the limit.
    const toolCalls = calls.filter((call) => call.method === 'tools/call');
    if (env.RATE_LIMITER) {
      for (const _call of toolCalls) {
        const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
        if (!success) {
          logCall(429, calls);
          return json(429, { error: RATE_LIMIT_MESSAGE }, { ...cors, 'retry-after': '60' });
        }
      }
    }

    const forwarded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : body
    });
    const response = await handler.fetch(forwarded);
    logCall(response.status, calls);
    return withHeaders(response, cors);
  }
};

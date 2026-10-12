// Hosted version on Cloudflare Workers: https://mcp.froala.com/mcp
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
  /** Comma-separated origins allowed to call /mcp from a browser, e.g. "https://example.com". */
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

/** The JSON-RPC method of the first message and the tool name, each only if it is a known one. Nothing else is read. */
function describeCall(body: Uint8Array): { method?: string; tool?: string } {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as { method?: unknown; params?: { name?: unknown } } | undefined;
    const method = typeof first?.method === 'string' ? (MCP_METHODS.has(first.method) ? first.method : 'other') : undefined;
    const name = first?.params?.name;
    return { method, tool: method === 'tools/call' && typeof name === 'string' && TOOL_NAMES.includes(name) ? name : undefined };
  } catch {
    return {};
  }
}

/**
 * Browsers send an Origin header; AI tools and servers usually don't. Requests without one are allowed.
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

/** The client's name and version from its user agent, e.g. "claude-code/2.1.0", at most 40 characters. */
const clientOf = (userAgent: string | null) => (userAgent?.split(/\s/)[0] ?? 'unknown').replace(/[^\w./-]/g, '').slice(0, 40) || 'unknown';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json(200, { ok: true, server: VERSION, froala: FROALA_VERSION });
    }
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response('Froala MCP server. Connect your AI tool to /mcp on this host. Setup: https://github.com/froala/froala-mcp\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    if (url.pathname !== '/mcp') return new Response('Not found\n', { status: 404 });
    if (!originAllowed(request.headers.get('origin'), env)) return json(403, { error: 'Requests from this website are not allowed.' });

    const body = await readBody(request);
    if (body === 'too large') return json(413, { error: 'The request is too large. Send at most 200,000 characters of code.' });
    const call = request.method === 'POST' ? describeCall(body) : {};

    // The limit counts tool calls only, so connecting and listing tools never use it up.
    if (env.RATE_LIMITER && call.method === 'tools/call') {
      const { success } = await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
      if (!success) return json(429, { error: RATE_LIMIT_MESSAGE }, { 'retry-after': '60' });
    }

    const started = Date.now();
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : body
    });
    const response = await handler.fetch(forwarded);

    // Statistics only. Arguments, code and questions are never logged, and the call name must be a known tool.
    const cf = (request as Request & { cf?: { country?: string } }).cf;
    console.log(
      JSON.stringify({
        event: 'mcp',
        call: call.tool ?? (call.method === 'tools/call' ? 'unknown tool' : (call.method ?? request.method)),
        http_status: response.status,
        ms: Date.now() - started,
        country: cf?.country ?? null,
        client: clientOf(request.headers.get('user-agent'))
      })
    );
    return response;
  }
};

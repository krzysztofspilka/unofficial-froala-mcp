// The hosted version, called the way Cloudflare Workers calls it.
import { expect, test } from 'vitest';
import worker, { type Env } from '../src/worker.js';
import { RATE_LIMIT_MESSAGE } from '../src/util.js';

const allow: Env = { RATE_LIMITER: { limit: async () => ({ success: true }) } };
const deny: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };

function rpc(method: string, params: object = {}, id = 1, headers: Record<string, string> = {}) {
  return new Request('https://mcp.froala.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
}

/** Reads a JSON-RPC answer, sent either as JSON or as a server-sent event. */
async function answer(response: Response) {
  const text = await response.text();
  const json = text.trim().startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data:'))!.slice(5);
  return JSON.parse(json);
}

test('health check', async () => {
  const response = await worker.fetch(new Request('https://mcp.froala.com/health'), allow);
  expect(await response.json()).toMatchObject({ ok: true, froala: '5.5.0' });
});

test('the rate limit counts tool calls only', async () => {
  const limited = await worker.fetch(rpc('tools/call', { name: 'froala_licensing', arguments: {} }), deny);
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect(((await limited.json()) as { error: string }).error).toBe(RATE_LIMIT_MESSAGE);
  expect((await worker.fetch(rpc('tools/list'), deny)).status).toBe(200);
});

test('lists the tools over HTTP', async () => {
  const init = await worker.fetch(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }), allow);
  expect((await answer(init)).result.serverInfo.name).toBe('froala');
  const list = await answer(await worker.fetch(rpc('tools/list', {}, 2), allow));
  expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('froala_check_code');
  expect(list.result.tools).toHaveLength(8);
});

test('large bodies are refused whether or not Content-Length is sent', async () => {
  const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { padding: 'x'.repeat(600_000) } } });
  const withoutLength = new Request('https://mcp.froala.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: new Blob([big]).stream(),
    duplex: 'half'
  } as RequestInit);
  expect((await worker.fetch(withoutLength, allow)).status).toBe(413);
});

test('browser pages from other websites are refused', async () => {
  expect((await worker.fetch(rpc('tools/list', {}, 1, { origin: 'https://evil.example' }), allow)).status).toBe(403);
  expect((await worker.fetch(rpc('tools/list', {}, 1, { origin: 'http://localhost:6274' }), allow)).status).toBe(200);
  expect((await worker.fetch(rpc('tools/list', {}, 1, { origin: 'https://app.example' }), { ...allow, ALLOWED_ORIGINS: 'https://app.example' })).status).toBe(200);
});

test('unknown paths', async () => {
  expect((await worker.fetch(new Request('https://mcp.froala.com/other'), allow)).status).toBe(404);
});

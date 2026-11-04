// The hosted version, called the way Cloudflare Workers calls it.
import { expect, test, vi } from 'vitest';
import worker, { type Env } from '../src/worker.js';
import { RATE_LIMIT_MESSAGE } from '../src/util.js';

const allow: Env = { RATE_LIMITER: { limit: async () => ({ success: true }) } };
const deny: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };

/** A limiter that counts how often it is asked. */
function counting(success: boolean) {
  const env = {
    calls: 0,
    RATE_LIMITER: {
      limit: async () => {
        env.calls += 1;
        return { success };
      }
    }
  };
  return env;
}

const TOOL_CALL = { name: 'froala_query_docs', arguments: { mode: 'licensing' } };

function batch(messages: object[], headers: Record<string, string> = {}) {
  return new Request('https://mcp.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify(messages.map((message, i) => ({ jsonrpc: '2.0', id: i + 1, ...message })))
  });
}

function rpc(method: string, params: object = {}, id = 1, headers: Record<string, string> = {}) {
  return new Request('https://mcp.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
}

/** Reads a JSON-RPC answer, sent either as JSON or as a server-sent event. */
async function answer(response: Response) {
  const text = await response.text();
  const json = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find((line) => line.startsWith('data:'))!
        .slice(5);
  return JSON.parse(json);
}

test('health check', async () => {
  const response = await worker.fetch(new Request('https://mcp.example.com/health'), allow);
  expect(await response.json()).toMatchObject({ ok: true, froala: '5.6.0' });
});

test('the rate limit counts tool calls only', async () => {
  const limited = await worker.fetch(rpc('tools/call', TOOL_CALL), deny);
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  expect(((await limited.json()) as { error: string }).error).toBe(RATE_LIMIT_MESSAGE);
  expect((await worker.fetch(rpc('tools/list'), deny)).status).toBe(200);
});

test('lists the tools over HTTP', async () => {
  const init = await worker.fetch(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }), allow);
  expect((await answer(init)).result.serverInfo.name).toBe('froala-mcp-server');
  const list = await answer(await worker.fetch(rpc('tools/list', {}, 2), allow));
  expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['froala_audit_code', 'froala_find_presets', 'froala_get_integration', 'froala_get_setup', 'froala_query_docs']);
});

test('large bodies are refused whether or not Content-Length is sent', async () => {
  const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { padding: 'x'.repeat(600_000) } } });
  const withoutLength = new Request('https://mcp.example.com/mcp', {
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

test('every tool call in a batch counts, wherever it stands', async () => {
  for (const messages of [
    [{ method: 'ping' }, { method: 'tools/call', params: TOOL_CALL }],
    [{ method: 'tools/call', params: TOOL_CALL }, { method: 'ping' }]
  ]) {
    const env = counting(false);
    const response = await worker.fetch(batch(messages), env);
    expect(response.status).toBe(429);
    expect(await response.text()).not.toContain('Try Froala');
    expect(env.calls).toBe(1);
  }
  const env = counting(true);
  await worker.fetch(
    batch([
      { method: 'tools/call', params: TOOL_CALL },
      { method: 'tools/call', params: TOOL_CALL },
      { method: 'tools/call', params: TOOL_CALL }
    ]),
    env
  );
  expect(env.calls).toBe(3);
});

test('malformed and oversized batches fail without running anything', async () => {
  const env = counting(true);
  const many = Array.from({ length: 21 }, () => ({ method: 'tools/call', params: TOOL_CALL }));
  expect((await worker.fetch(batch(many), env)).status).toBe(400);
  expect(env.calls).toBe(0);
  const odd = new Request('https://mcp.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify([null, 1, 'x'])
  });
  expect((await worker.fetch(odd, env)).status).toBeGreaterThanOrEqual(400);
  expect(env.calls).toBe(0);
});

test('allowed browser pages get CORS headers on every answer', async () => {
  const origin = 'https://app.example';
  const env = { ...allow, ALLOWED_ORIGINS: origin };
  const preflight = await worker.fetch(new Request('https://mcp.example.com/mcp', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } }), env);
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
  expect(preflight.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version');
  const ok = await worker.fetch(rpc('tools/list', {}, 1, { origin }), env);
  expect(ok.headers.get('access-control-allow-origin')).toBe(origin);
  expect(ok.headers.get('access-control-expose-headers')).toContain('mcp-session-id');
  const limited = await worker.fetch(rpc('tools/call', TOOL_CALL, 1, { origin }), { ...deny, ALLOWED_ORIGINS: origin });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('access-control-allow-origin')).toBe(origin);
  const big = new Request('https://mcp.example.com/mcp', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: 'x'.repeat(600_000) });
  const refused = await worker.fetch(big, env);
  expect(refused.status).toBe(413);
  expect(refused.headers.get('access-control-allow-origin')).toBe(origin);
});

test('the preflight allows the headers of the newest protocol', async () => {
  const preflight = await worker.fetch(new Request('https://mcp.example.com/mcp', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), allow);
  for (const header of ['mcp-method', 'mcp-name', 'mcp-protocol-version']) expect(preflight.headers.get('access-control-allow-headers')).toContain(header);
});

test('statistics name every tool in a batch, and refused requests, and nothing else', async () => {
  const lines: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
  const secret = { name: 'froala_query_docs', arguments: { mode: 'search', query: 'my secret words' } };
  await worker.fetch(batch([{ method: 'ping' }, { method: 'tools/call', params: secret }, { method: 'tools/call', params: TOOL_CALL }]), allow);
  await worker.fetch(rpc('tools/call', TOOL_CALL), deny);
  log.mockRestore();
  const [first, second] = lines.map((line) => JSON.parse(line));
  expect(first.tools).toEqual(['froala_query_docs', 'froala_query_docs']);
  expect(first.calls).toBe(3);
  expect(second.http_status).toBe(429);
  expect(second.tools).toEqual(['froala_query_docs']);
  expect(lines.join(' ')).not.toContain('secret');
});

test('other browser pages get no CORS headers', async () => {
  const preflight = await worker.fetch(new Request('https://mcp.example.com/mcp', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), allow);
  expect(preflight.status).toBe(403);
  expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
});

test('calls from AI tools have no CORS headers', async () => {
  const response = await worker.fetch(rpc('tools/list'), allow);
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
});

test('the prompts follow the target and the use case', async () => {
  const prompt = async (name: string, args: object) => (await answer(await worker.fetch(rpc('prompts/get', { name, arguments: args }), allow))).result.messages[0].content.text as string;
  const plain = await prompt('add-froala', { target: 'vue' });
  expect(plain).toContain('target "vue"');
  expect(plain).not.toContain('froala_find_presets');
  const withUse = await prompt('add-froala', { target: 'react', use_case: 'comments' });
  expect(withUse).toContain('froala_find_presets with the query "comments"');
  expect(await prompt('review-froala', {})).toContain('froala_audit_code');
});

test('unknown paths', async () => {
  expect((await worker.fetch(new Request('https://mcp.example.com/other'), allow)).status).toBe(404);
});

// What a client sees. Every tool must explain itself, so a model can pick the right one.
import { describe, expect, test } from 'vitest';
import worker, { type Env } from '../src/worker.js';

const env: Env = {};

async function list() {
  const request = new Request('https://mcp.example.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  });
  const text = await (await worker.fetch(request, env)).text();
  const json = text.trim().startsWith('{')
    ? text
    : text
        .split('\n')
        .find((line) => line.startsWith('data:'))!
        .slice(5);
  return JSON.parse(json).result.tools as {
    name: string;
    title: string;
    description: string;
    annotations: Record<string, boolean>;
    inputSchema: { properties: Record<string, { description?: string }>; additionalProperties: boolean };
  }[];
}

describe('the tool list', async () => {
  const tools = await list();

  test('there are five tools, named with the service and a verb', () => {
    expect(tools).toHaveLength(5);
    for (const tool of tools) expect(tool.name).toMatch(/^froala_(get|find|audit|query)_[a-z]+$/);
  });

  test.each(tools.map((tool) => [tool.name, tool] as const))('%s explains itself', (_name, tool) => {
    expect(tool.title).toMatch(/^Froala /);
    expect(tool.description).toMatch(/^Use this/);
    expect(tool.description).toContain('Example');
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tool.inputSchema.additionalProperties).toBe(false);
    for (const [name, input] of Object.entries(tool.inputSchema.properties)) expect(input.description, name).toBeTruthy();
    expect(
      tools.some((other) => other.name !== tool.name && tool.description.includes(other.name)),
      'it names a related tool'
    ).toBe(true);
  });
});

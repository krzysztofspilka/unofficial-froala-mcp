// The local version. An AI tool starts it with `npx -y @froala/mcp` and talks to it over stdin and stdout.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createFroalaServer, VERSION } from './server.js';
import { FROALA_VERSION } from './data.js';

serveStdio(() => createFroalaServer());

// stdout carries the protocol, so messages for people go to stderr.
console.error(`Froala MCP server ${VERSION} (Froala ${FROALA_VERSION}) is running on stdio.`);

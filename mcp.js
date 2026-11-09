// The assistant's tools over MCP (assistant/2): the app's own server answers the Model
// Context Protocol at /api/mcp, so the claude command it starts can use them (assistant-tools.js).
// Plain JSON-RPC over HTTP POST (the protocol's Streamable HTTP, answered as JSON), with no
// extra package. Only the claude command the app started can call it: every request needs
// the secret made when the app starts (never shown to a page, never logged), and names the
// conversation it works for.

import { timingSafeEqual } from 'node:crypto';
import { offeredTools, runTool } from './assistant-tools.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'app', version: '1.0.0' };

const sameSecret = (given, secret) => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function answer(message, runFor, tools) {
  const { id, method, params = {} } = message;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const problem = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return reply({ protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} }, serverInfo: SERVER });
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools });
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    if (!tools.some((tool) => tool.name === name)) return problem(-32602, `There is no tool called ${name}.`);
    try {
      return reply({ content: [{ type: 'text', text: await runFor(name, args ?? {}) }], isError: false });
    } catch (err) {
      return reply({ content: [{ type: 'text', text: err.status ? err.message : 'Something went wrong in the app.' }], isError: true });
    }
  }
  return problem(-32601, `Not something this server does: ${method}`);
}

// Handles one request to /api/mcp. run(conversationId) gives what the tools need for the
// answer under way in that conversation.
export async function handleMcp(req, res, { secret, readJson, sendJson, db, run }) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), secret)) return sendJson(res, 401, { error: 'Not allowed.' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const conversationId = new URL(req.url, 'http://app').searchParams.get('conversation') ?? '';
  const body = await readJson(req);
  const messages = Array.isArray(body) ? body : [body];
  const context = run(conversationId);
  const replies = await Promise.all(messages.filter((m) => m && m.id !== undefined && m.method)
    .map((m) => answer(m, (name, args) => runTool(db, name, args, context), offeredTools(db))));
  if (!replies.length) { res.writeHead(202); res.end(); return undefined; }
  return sendJson(res, 200, Array.isArray(body) ? replies : replies[0]);
}

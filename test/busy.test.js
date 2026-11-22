// **Bentrix's rate limit is waited out, never surfaced while it passes**: a request answered busy (HTTP 429,
// -40001) ran nothing, so the client sends it again after the wait the answer names; past BUSY_RETRIES the refusal is thrown.
//
//   node --test sdk/node/test/busy.test.js
//
// Mutations (2026-11-06), each red: the retry removed (the first busy answer was thrown); the bound
// removed (the eleventh busy answer was not thrown).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Client, RpcError, BUSY, BUSY_RETRIES } = require('../mcp/client.js');

function stub(busyFirst) {
  let busy = busyFirst;
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      seen.push(msg.method);
      res.setHeader('Content-Type', 'application/json');
      if (busy > 0) {
        busy -= 1;
        res.statusCode = 429;
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -40001, message: 'Rate limited: slow down', data: { retryAfterMs: 5 } } }));
        return;
      }
      const answer = { ok: true };
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

test('a busy answer is sent again after its wait, and the call answers', async () => {
  const s = await stub(3);
  try {
    const out = await new Client(s.url, 't').call('get_state', {});
    assert.deepStrictEqual(out, { ok: true }, 'the first busy answer was thrown');
    assert.strictEqual(s.seen.length, 4);
  } finally {
    s.server.close();
  }
});

test('past the bound the busy refusal is thrown', async () => {
  const s = await stub(BUSY_RETRIES + 1);
  try {
    await assert.rejects(new Client(s.url, 't').call('get_state', {}), (e) => e instanceof RpcError && e.code === BUSY, 'the eleventh busy answer was not thrown');
    assert.strictEqual(s.seen.length, BUSY_RETRIES + 1);
  } finally {
    s.server.close();
  }
});

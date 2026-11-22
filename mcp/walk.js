'use strict';
/*
 * The JavaScript MCP client's walk against a running BENTRIX (bentrix --serve over the CI tape): it
 * finds the application and pairs with nothing typed, reads its state through the generated surface,
 * reads a resource by its template, and runs the same Gym episode every binding runs - through the
 * agents' tools this time, over the wire - printed as JSON for sdk/python/tests/test_crosslang.py.
 *
 *   LOCALAPPDATA=<the serve's> node sdk/node/mcp/walk.js
 */
const { connect, ToolError } = require('./index.js');

function check(held, what) {
  if (!held) throw new Error(`FAILED: ${what}`);
}

(async () => {
  const b = await connect({ name: 'node-walk' });
  const state = await b.workspace.getState({});
  const bench = state.laboratories[0].benches[0].uri;
  const [home, owner, , name] = bench.replace('bentrix://', '').split('/');
  const book = await b.trade.book({ home, owner, bench: name });
  check(Array.isArray(book.positions), `the book did not read: ${JSON.stringify(book)}`);
  let said = '';
  try {
    await b.call('no_such_tool', {});
  } catch (e) {
    said = String(e.message);
  }
  check(said.includes('no_such_tool'), `a refusal did not say its tool: ${said}`);

  const made = await b.strategy.envMake({ bench, interval: 'H1', window: 8, episode: 'window', episode_bars: 12 });
  const actions = [1, 1, 2, 0, 2, 2, 1, 0, 1, 2, 0, 1];
  const start = await b.strategy.envReset({ env: made.env, seed: 5 });
  check(start.obs.market.length === 8, 'the observation is not shaped as declared');
  const rewards = [];
  const hashes = [start.info.ledger_hash];
  for (const a of actions) {
    const s = await b.strategy.envStep({ env: made.env, action: a });
    rewards.push(s.reward);
    hashes.push(s.info.ledger_hash);
    if (s.terminated || s.truncated) break;
  }
  await b.strategy.envClose({ env: made.env });
  // A tool's own refusal (isError), not a request the wire refused (an unknown tool is a JSON-RPC error).
  let refusal = null;
  try {
    await b.strategy.envStep({ env: made.env, action: 0 });
  } catch (e) {
    refusal = e;
  }
  check(refusal instanceof ToolError && refusal.message.includes('No environment'), `a closed environment's step was not refused in its words: ${refusal}`);
  check(new Set(hashes).size > 1, 'the episode traded nothing');
  console.log(JSON.stringify({ start_ms: start.info.start_ms, rewards, hashes }));
  console.log('PASS');
})().catch((e) => {
  console.error(e instanceof ToolError ? `${e.tool}: ${e.message}` : e.stack || String(e));
  process.exit(1);
});
